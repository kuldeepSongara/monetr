import type { AIAttempt, AIProfile, ProfileHealth, Settings } from '../types'
import { nowISO } from '../lib/dates'
import { db, logAI, setMeta, setProfileHealth, updateSettings } from '../db/db'
import { PROVIDERS, canUseProfile, capabilityGap, liveModel, modelSeesImages, profileLabel } from './providers'

export interface AICallOptions {
  prompt: string
  system?: string
  json?: boolean
  /** data URLs (data:image/jpeg;base64,…) */
  images?: string[]
  /** PDF data URLs (data:application/pdf;base64,…). Only Gemini, Claude and OpenAI accept these. */
  pdfs?: string[]
  maxTokens?: number
  temperature?: number
  task: string
  timeoutMs?: number
  /** Hard cap for the whole call: every retry, backup model and failover profile together. */
  budgetMs?: number
  /** Skip the model's "thinking" step (Gemini 2.5 Flash) — much faster for plain extraction. */
  fast?: boolean
  signal?: AbortSignal
  /** Internal: absolute deadline derived from budgetMs. */
  deadline?: number
}

export interface AIResult {
  text: string
  profileId: string
  profileName: string
  provider: AIProfile['provider']
  model: string
  attempts: AIAttempt[]
  ms: number
}

export class AIError extends Error {
  attempts: AIAttempt[]
  code?: 'no-capable-profile' | 'all-failed' | 'timeout'
  constructor(message: string, attempts: AIAttempt[] = [], code?: AIError['code']) {
    super(message)
    this.name = 'AIError'
    this.attempts = attempts
    this.code = code
  }
}

const cooldowns = new Map<string, number>()
const COOLDOWN_MS = 45_000

export function resetCooldowns(): void {
  cooldowns.clear()
}

function trimUrl(url: string): string {
  return (url || '').trim().replace(/\/+$/, '')
}

function dataUrlParts(dataUrl: string): { mime: string; data: string } {
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/s)
  if (!match) throw new Error('Unsupported image format')
  return { mime: match[1], data: match[2] }
}

function shortError(body: string): string {
  const text = body.trim()
  if (!text) return ''
  try {
    const parsed = JSON.parse(text)
    const msg =
      parsed?.error?.message ??
      parsed?.error?.status ??
      parsed?.message ??
      parsed?.detail ??
      (Array.isArray(parsed) ? parsed[0]?.message : undefined)
    if (typeof msg === 'string' && msg.trim()) return msg.slice(0, 300)
  } catch {
    /* not json */
  }
  return text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 300)
}

export class HttpError extends Error {
  constructor(
    message: string,
    public status: number,
    public retryAfterMs?: number,
  ) {
    super(message)
  }
}

/** Overloaded / rate-limited / flaky — worth retrying or trying another model. */
export function isTransient(err: unknown): boolean {
  const status = err instanceof HttpError ? err.status : 0
  if ([408, 429, 500, 502, 503, 504, 529].includes(status)) return true
  const msg = err instanceof Error ? err.message : String(err)
  return /overloaded|UNAVAILABLE|RESOURCE_EXHAUSTED|rate limit|quota|try again later|timed out/i.test(msg)
}

/** The model itself is unknown/unavailable for this key — try the next model, not a retry. */
function isModelProblem(err: unknown): boolean {
  const status = err instanceof HttpError ? err.status : 0
  const msg = err instanceof Error ? err.message : ''
  return status === 404 || /model.*(not found|does not exist|not supported|decommissioned)/i.test(msg)
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms)
    signal?.addEventListener('abort', () => {
      clearTimeout(t)
      reject(new Error('Cancelled'))
    })
  })

async function postJson(
  url: string,
  headers: Record<string, string>,
  body: unknown,
  timeoutMs: number,
  external?: AbortSignal,
): Promise<unknown> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const relay = () => controller.abort()
  external?.addEventListener('abort', relay)
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
    const text = await res.text()
    if (!res.ok) {
      const retryAfter = Number(res.headers.get('retry-after'))
      throw new HttpError(
        `${res.status} ${res.statusText}${text ? ` · ${shortError(text)}` : ''}`.trim(),
        res.status,
        Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : undefined,
      )
    }
    try {
      return JSON.parse(text)
    } catch {
      throw new Error('The provider returned a non-JSON response.')
    }
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      if (external?.aborted) throw new Error('Cancelled')
      throw new HttpError(`Request timed out after ${Math.round(timeoutMs / 1000)}s`, 408)
    }
    if (err instanceof TypeError) {
      throw new Error('Network error or CORS blocked. Check the base URL, your connection, and whether this provider allows browser requests.')
    }
    throw err
  } finally {
    clearTimeout(timer)
    external?.removeEventListener('abort', relay)
  }
}

interface GooglePart {
  text?: string
  inlineData?: { mimeType: string; data: string }
}
interface GoogleResponse {
  candidates?: { content?: { parts?: GooglePart[] }; finishReason?: string }[]
  promptFeedback?: { blockReason?: string }
}
interface OpenAIResponse {
  choices?: { message?: { content?: string | { text?: string }[]; refusal?: string | null }; finish_reason?: string }[]
}
interface AnthropicResponse {
  content?: { type: string; text?: string }[]
  stop_reason?: string
}

async function callGoogle(profile: AIProfile, opts: AICallOptions, timeoutMs: number): Promise<string> {
  const parts: GooglePart[] = [{ text: opts.prompt }]
  for (const img of [...(opts.images ?? []), ...(opts.pdfs ?? [])]) {
    const { mime, data } = dataUrlParts(img)
    parts.push({ inlineData: { mimeType: mime, data } })
  }

  const body: Record<string, unknown> = {
    contents: [{ parts }],
  }

  const genConfig: Record<string, unknown> = {}
  const maxT = opts.maxTokens ?? profile.maxTokens
  if (maxT) genConfig.maxOutputTokens = maxT
  const temp = opts.temperature ?? profile.temperature
  if (temp !== undefined) genConfig.temperature = temp
  if (opts.json) genConfig.responseMimeType = 'application/json'
  // Flash models "think" before answering by default; for reading a table that's just latency.
  // Only on 2.5 Flash, where a zero budget is documented; newer Flash models handle thinking differently.
  if (opts.fast && /2\.5-flash/i.test(profile.model)) genConfig.thinkingConfig = { thinkingBudget: 0 }
  if (Object.keys(genConfig).length) body.generationConfig = genConfig

  if (opts.system?.trim()) {
    body.systemInstruction = { parts: [{ text: opts.system.trim() }] }
  }

  const base = trimUrl(profile.baseUrl) || 'https://generativelanguage.googleapis.com/v1beta'
  const url = `${base}/models/${encodeURIComponent(profile.model || 'gemini-flash-latest')}:generateContent`

  try {
    const data = (await postJson(
      url,
      { 'x-goog-api-key': profile.apiKey, 'Content-Type': 'application/json', ...(profile.extraHeaders ?? {}) },
      body,
      timeoutMs,
      opts.signal,
    )) as GoogleResponse

    if (data.promptFeedback?.blockReason) {
      throw new Error(`Blocked by safety filter (${data.promptFeedback.blockReason})`)
    }
    const candidate = data.candidates?.[0]
    const text = (candidate?.content?.parts ?? [])
      .map((p) => p.text ?? '')
      .join('')
      .trim()
    if (!text) {
      throw new Error(
        candidate?.finishReason === 'MAX_TOKENS'
          ? 'The model ran out of output tokens before answering.'
          : `The model returned an empty response. (finishReason: ${candidate?.finishReason || 'unknown'})`,
      )
    }
    return text
  } catch (err) {
    if (!(err instanceof Error)) throw err
    const status = err instanceof HttpError ? err.status : 0
    const msg = err.message
    // Add hints but keep the HttpError (status) so retry/failover logic still works.
    if (status === 503 || /overloaded/i.test(msg)) err.message = `${msg} — Gemini is overloaded right now; Monetr retries and then tries your backup model/profile.`
    else if (status === 429) err.message = `${msg} — Free-tier quota hit for this model.`
    else if (status === 400) err.message = `${msg} — Check API key, model name, or base URL.`
    else if (status === 401 || status === 403 || msg.includes('API_KEY')) err.message = `${msg} — API key invalid or missing.`
    else if (status === 404) err.message = `${msg} — Model not found or retired. Try gemini-flash-latest.`
    throw err
  }
}

async function callOpenAI(profile: AIProfile, opts: AICallOptions, timeoutMs: number): Promise<string> {
  const content =
    opts.images?.length || opts.pdfs?.length
      ? [
          { type: 'text', text: opts.prompt },
          ...(opts.images ?? []).map((url) => ({ type: 'image_url', image_url: { url } })),
          ...(opts.pdfs ?? []).map((url, i) => ({ type: 'file', file: { filename: `statement-${i + 1}.pdf`, file_data: url } })),
        ]
      : opts.prompt

  const messages: Record<string, unknown>[] = []
  if (opts.system) messages.push({ role: 'system', content: opts.system })
  messages.push({ role: 'user', content })

  const body: Record<string, unknown> = { model: profile.model, messages }
  if (opts.temperature !== undefined || profile.temperature !== undefined) {
    body.temperature = opts.temperature ?? profile.temperature
  }
  const maxTokens = opts.maxTokens ?? profile.maxTokens
  if (maxTokens) body.max_tokens = maxTokens
  // Qwen 3.x on Groq "thinks" by default — slow, and the reasoning can leak into the answer.
  if (profile.provider === 'groq' && /qwen3/i.test(profile.model)) body.reasoning_effort = 'none'

  const data = (await postJson(
    `${trimUrl(profile.baseUrl)}/chat/completions`,
    { Authorization: `Bearer ${profile.apiKey || 'not-needed'}`, ...(profile.extraHeaders ?? {}) },
    body,
    timeoutMs,
    opts.signal,
  )) as OpenAIResponse

  const message = data.choices?.[0]?.message
  const text =
    typeof message?.content === 'string'
      ? message.content
      : (message?.content ?? []).map((c) => c.text ?? '').join('')
  const trimmed = (text || '').replace(/<think>[\s\S]*?<\/think>/gi, '').trim()
  if (!trimmed) {
    throw new Error(message?.refusal ? `Refused: ${message.refusal}` : 'The model returned an empty response.')
  }
  return trimmed
}

async function callAnthropic(profile: AIProfile, opts: AICallOptions, timeoutMs: number): Promise<string> {
  const content: Record<string, unknown>[] = [{ type: 'text', text: opts.prompt }]
  for (const img of opts.images ?? []) {
    const { mime, data } = dataUrlParts(img)
    content.push({ type: 'image', source: { type: 'base64', media_type: mime, data } })
  }
  for (const pdf of opts.pdfs ?? []) {
    const { data } = dataUrlParts(pdf)
    content.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data } })
  }

  const body: Record<string, unknown> = {
    model: profile.model,
    max_tokens: opts.maxTokens ?? profile.maxTokens ?? 2048,
    messages: [{ role: 'user', content }],
  }
  if (opts.system) body.system = opts.system
  if (opts.temperature !== undefined || profile.temperature !== undefined) {
    body.temperature = opts.temperature ?? profile.temperature
  }

  const data = (await postJson(
    `${trimUrl(profile.baseUrl)}/v1/messages`,
    {
      'x-api-key': profile.apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
      ...(profile.extraHeaders ?? {}),
    },
    body,
    timeoutMs,
    opts.signal,
  )) as AnthropicResponse

  const text = (data.content ?? [])
    .filter((c) => c.type === 'text')
    .map((c) => c.text ?? '')
    .join('')
    .trim()
  if (!text) throw new Error('The model returned an empty response.')
  return text
}

async function callProvider(profile: AIProfile, opts: AICallOptions): Promise<string> {
  const def = PROVIDERS[profile.provider]
  if (!def) throw new Error(`Unknown provider: ${profile.provider}`)
  if (!profile.model?.trim()) throw new Error('No model selected for this profile')
  if (def.requiresKey && !profile.apiKey?.trim()) throw new Error('Missing API key')

  let timeoutMs = opts.timeoutMs ?? (opts.images?.length || opts.pdfs?.length ? 90_000 : 60_000)
  if (opts.deadline) {
    const left = opts.deadline - Date.now()
    if (left < 3000) throw new BudgetError()
    timeoutMs = Math.min(timeoutMs, left)
  }
  if (def.kind === 'google') return callGoogle(profile, opts, timeoutMs)
  if (def.kind === 'anthropic') return callAnthropic(profile, opts, timeoutMs)
  return callOpenAI(profile, opts, timeoutMs)
}

/**
 * One profile, made resilient: retry transient errors (Gemini "model is overloaded", 429s) with
 * backoff, then walk the profile's backup models (same key — free quotas are per model) before the
 * caller fails over to the next profile.
 */
class BudgetError extends Error {
  constructor() {
    super('Took too long — the AI provider is very slow right now.')
  }
}

async function callWithRecovery(profile: AIProfile, opts: AICallOptions): Promise<{ text: string; model: string }> {
  // Retired model names are swapped for their replacements, and the provider's current backups are
  // added at the end so an old saved profile never dead-ends on models that no longer exist.
  const defaults = PROVIDERS[profile.provider]?.fallbackModels ?? []
  let models = [profile.model, ...(profile.fallbackModels ?? []), ...defaults]
    .map((m) => liveModel(profile.provider, m))
    .filter(Boolean)
  if (opts.images?.length) {
    // Images: only image-capable models, plus the provider's vision model on the same key (e.g. Groq → Llama 4 Scout).
    const visionModel = PROVIDERS[profile.provider]?.visionModel
    models = [...models.filter((m) => modelSeesImages(profile, m)), ...(visionModel ? [visionModel] : [])]
  }
  const unique = [...new Set(models)]
  let lastErr: unknown = new Error('No model configured')
  for (const model of unique) {
    const p = { ...profile, model }
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return { text: await callProvider(p, opts), model }
      } catch (err) {
        lastErr = err
        if (opts.signal?.aborted || err instanceof BudgetError) throw err
        if (isModelProblem(err)) break
        // 400s are usually about this model (unsupported option, input type) — try the next model.
        if (err instanceof HttpError && err.status === 400) break
        if (!isTransient(err)) throw err
        // A timeout means this model is slow right now — waiting again on it just doubles the wait.
        if (err instanceof HttpError && err.status === 408) break
        if (attempt < 2) {
          const hinted = err instanceof HttpError ? err.retryAfterMs : undefined
          await sleep(Math.min(8000, hinted ?? 1200 * 2 ** attempt + Math.random() * 400), opts.signal)
        }
      }
    }
  }
  throw lastErr
}

async function recordHealth(profile: AIProfile, health: ProfileHealth): Promise<void> {
  try {
    await setProfileHealth(profile.id, health)
  } catch {
    /* profile may not be saved yet */
  }
}

/**
 * Calls the preferred AI profile, falling back through the priority list.
 * Successful failovers are persisted to settings so the UI always reflects
 * which profile is actually serving requests.
 */
export async function callAI(opts: AICallOptions): Promise<AIResult> {
  if (opts.budgetMs && !opts.deadline) opts = { ...opts, deadline: Date.now() + opts.budgetMs }
  const [settings, all] = await Promise.all([db.settings.get('settings'), db.profiles.toArray()])
  const sorted = [...all].sort((a, b) => a.priority - b.priority)
  // Explain every profile that won't be tried, so "all profiles failed" is never a mystery.
  const skipped: string[] = []
  for (const p of sorted) {
    if (!p.enabled) skipped.push(`${profileLabel(p)}: turned off`)
    else if (!canUseProfile(p)) skipped.push(`${profileLabel(p)}: missing key or model`)
  }
  const ready = sorted.filter(canUseProfile)
  if (!ready.length) {
    throw new AIError('No AI profile is ready. Add a key in Settings → AI profiles.')
  }
  // Only route image / PDF requests to profiles that can read them, so failover doesn't waste a
  // call (and a cooldown) on a text-only model.
  const needs = { images: Boolean(opts.images?.length), pdfs: Boolean(opts.pdfs?.length) }
  const usable = ready.filter((p) => {
    const gap = capabilityGap(p, needs)
    if (gap) skipped.push(`${profileLabel(p)}: ${gap}`)
    return !gap
  })
  if (!usable.length) {
    throw new AIError(
      opts.pdfs?.length
        ? `Reading PDFs needs a Gemini, Claude or OpenAI profile. (${skipped.join(' · ')})`
        : `None of your profiles can see images. (${skipped.join(' · ')})`,
      [],
      'no-capable-profile',
    )
  }

  const preferred = settings?.activeProfileId ? usable.find((p) => p.id === settings.activeProfileId) : undefined
  let queue = preferred ? [preferred, ...usable.filter((p) => p.id !== preferred.id)] : usable
  if (settings && !settings.failoverEnabled) queue = queue.slice(0, 1)

  const now = Date.now()
  const notCooling = queue.filter((p) => (cooldowns.get(p.id) ?? 0) <= now)
  if (notCooling.length) queue = notCooling

  const attempts: AIAttempt[] = []
  for (let i = 0; i < queue.length; i++) {
    if (opts.signal?.aborted) throw new AIError('Cancelled', attempts)
    if (opts.deadline && opts.deadline - Date.now() < 3000) break
    const profile = queue[i]
    const started = performance.now()
    try {
      const { text, model: usedModel } = await callWithRecovery(profile, opts)
      const ms = Math.round(performance.now() - started)
      attempts.push({
        profileId: profile.id,
        profileName: profileLabel(profile),
        provider: profile.provider,
        model: usedModel,
        ok: true,
        ms,
      })
      cooldowns.delete(profile.id)
      await recordHealth(profile, { status: 'ok', checkedAt: nowISO(), latencyMs: ms })
      await logAI({
        at: nowISO(),
        task: opts.task,
        profileId: profile.id,
        profileName: profileLabel(profile),
        provider: profile.provider,
        model: usedModel,
        ok: true,
        ms,
      })

      if (settings?.autoSwitchActive && queue[0].id !== profile.id) {
        await updateSettings({ activeProfileId: profile.id })
        await setMeta('ai:lastFailover', {
          at: nowISO(),
          from: profileLabel(queue[0]),
          to: profileLabel(profile),
          error: attempts[attempts.length - 2]?.error ?? 'Preferred profile failed',
          task: opts.task,
        })
      }

      return {
        text,
        profileId: profile.id,
        profileName: profileLabel(profile),
        provider: profile.provider,
        model: usedModel,
        attempts,
        ms,
      }
    } catch (err) {
      const ms = Math.round(performance.now() - started)
      const message = err instanceof Error ? err.message : String(err)
      attempts.push({
        profileId: profile.id,
        profileName: profileLabel(profile),
        provider: profile.provider,
        model: profile.model,
        ok: false,
        error: message,
        ms,
      })
      cooldowns.set(profile.id, Date.now() + COOLDOWN_MS)
      await recordHealth(profile, { status: 'error', message, checkedAt: nowISO(), latencyMs: ms })
      await logAI({
        at: nowISO(),
        task: opts.task,
        profileId: profile.id,
        profileName: profileLabel(profile),
        provider: profile.provider,
        model: profile.model,
        ok: false,
        ms,
        error: message,
      })
    }
  }

  const summary = attempts.map((a) => `${a.profileName}: ${a.error}`).join(' · ')
  const skippedNote = skipped.length ? ` Not tried — ${skipped.join(' · ')}.` : ''
  if (opts.deadline && opts.deadline - Date.now() < 3000) {
    throw new AIError(
      `Gave up after ${Math.round((opts.budgetMs ?? 0) / 1000) || 'a while'}s — the AI provider is too slow right now. Try again in a minute, or add a free backup profile (Settings → AI profiles).${summary ? ` (${summary})` : ''}${skippedNote}`,
      attempts,
      'timeout',
    )
  }
  throw new AIError(
    `${queue.length > 1 ? `All ${queue.length} AI profiles that can handle this failed` : 'AI request failed'}. ${summary}.${skippedNote}`,
    attempts,
    'all-failed',
  )
}

export interface TestResult {
  ok: boolean
  ms: number
  text?: string
  error?: string
}

export async function testProfile(profile: AIProfile): Promise<TestResult> {
  const started = performance.now()
  try {
    const text = await callProvider({ ...profile, model: liveModel(profile.provider, profile.model) }, {
      prompt: 'Reply with the single word: OK',
      task: 'connection-test',
      // Room for models that think before answering (they count thinking as output).
      maxTokens: 1024,
      fast: true,
      temperature: 0,
      timeoutMs: 30_000,
    })
    const ms = Math.round(performance.now() - started)
    await recordHealth(profile, { status: 'ok', checkedAt: nowISO(), latencyMs: ms })
    return { ok: true, ms, text: text.slice(0, 120) }
  } catch (err) {
    const ms = Math.round(performance.now() - started)
    const message = err instanceof Error ? err.message : String(err)
    await recordHealth(profile, { status: 'error', message, checkedAt: nowISO(), latencyMs: ms })
    return { ok: false, ms, error: message }
  }
}

export function describeSettings(settings: Settings | undefined, profiles: AIProfile[]): string {
  if (!settings) return 'AI not configured'
  const active = profiles.find((p) => p.id === settings.activeProfileId)
  if (active) return `${profileLabel(active)} · ${active.model}`
  if (profiles.length) return 'No profile pinned'
  return 'AI not configured'
}
