import type { AIProfile, ProviderId } from '../types'
import { nowISO } from '../lib/dates'
import { uid } from '../lib/utils'

export interface ProviderDef {
  id: ProviderId
  label: string
  short: string
  kind: 'google' | 'openai' | 'anthropic'
  baseUrl: string
  models: string[]
  defaultModel: string
  /** Models tried with the same key when the main one is overloaded or out of free quota. */
  fallbackModels?: string[]
  /** Short description of the free tier, shown when picking a backup. */
  freeTier?: string
  keyUrl?: string
  keyHint?: string
  supportsVision: boolean
  requiresKey: boolean
  notes?: string
}

export const PROVIDERS: Record<ProviderId, ProviderDef> = {
  google: {
    id: 'google',
    label: 'Google Gemini (Google AI Studio)',
    short: 'Gemini',
    kind: 'google',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    models: ['gemini-2.5-flash', 'gemini-flash-latest', 'gemini-2.5-flash-lite', 'gemini-2.5-pro', 'gemini-2.0-flash'],
    defaultModel: 'gemini-2.5-flash',
    fallbackModels: ['gemini-flash-latest', 'gemini-2.5-flash-lite', 'gemini-2.0-flash'],
    freeTier: 'Free key; quotas are per model and Flash is often overloaded at peak times.',
    keyUrl: 'https://aistudio.google.com/apikey',
    keyHint: 'Paste your Google AI Studio API key (AIza...)',
    supportsVision: true,
    requiresKey: true,
  },
  openai: {
    id: 'openai',
    label: 'OpenAI',
    short: 'OpenAI',
    kind: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    models: ['gpt-4o-mini', 'gpt-4o', 'gpt-4.1-mini', 'gpt-4.1', 'o4-mini'],
    defaultModel: 'gpt-4o-mini',
    keyUrl: 'https://platform.openai.com/api-keys',
    keyHint: 'Starts with sk-…',
    supportsVision: true,
    requiresKey: true,
  },
  anthropic: {
    id: 'anthropic',
    label: 'Anthropic Claude',
    short: 'Claude',
    kind: 'anthropic',
    baseUrl: 'https://api.anthropic.com',
    models: ['claude-sonnet-4-5', 'claude-haiku-4-5', 'claude-opus-4-1', 'claude-3-5-haiku-latest'],
    defaultModel: 'claude-sonnet-4-5',
    keyUrl: 'https://console.anthropic.com/settings/keys',
    keyHint: 'Starts with sk-ant-…',
    supportsVision: true,
    requiresKey: true,
    notes: 'Browser access uses Anthropic’s direct-browser header.',
  },
  openrouter: {
    id: 'openrouter',
    label: 'OpenRouter',
    short: 'OpenRouter',
    kind: 'openai',
    baseUrl: 'https://openrouter.ai/api/v1',
    models: [
      'meta-llama/llama-3.3-70b-instruct:free',
      'openai/gpt-oss-120b:free',
      'qwen/qwen3-coder:free',
      'google/gemini-2.5-flash',
      'openai/gpt-4o-mini',
    ],
    defaultModel: 'meta-llama/llama-3.3-70b-instruct:free',
    fallbackModels: ['openai/gpt-oss-120b:free'],
    freeTier: 'Models ending in :free cost nothing — about 20 requests/min and 50/day (1,000/day after a one-time $10 top-up).',
    keyUrl: 'https://openrouter.ai/keys',
    keyHint: 'Starts with sk-or-…',
    supportsVision: true,
    requiresKey: true,
    notes: 'One key, many models. Handy as a failover.',
  },
  groq: {
    id: 'groq',
    label: 'Groq',
    short: 'Groq',
    kind: 'openai',
    baseUrl: 'https://api.groq.com/openai/v1',
    models: ['llama-3.3-70b-versatile', 'openai/gpt-oss-120b', 'meta-llama/llama-4-scout-17b-16e-instruct', 'llama-3.1-8b-instant'],
    defaultModel: 'llama-3.3-70b-versatile',
    fallbackModels: ['openai/gpt-oss-120b', 'llama-3.1-8b-instant'],
    freeTier: 'Free key, very fast, generous daily limits. Llama 4 Scout can read images.',
    keyUrl: 'https://console.groq.com/keys',
    keyHint: 'Starts with gsk_…',
    supportsVision: false,
    requiresKey: true,
  },
  deepseek: {
    id: 'deepseek',
    label: 'DeepSeek',
    short: 'DeepSeek',
    kind: 'openai',
    baseUrl: 'https://api.deepseek.com/v1',
    models: ['deepseek-chat', 'deepseek-reasoner'],
    defaultModel: 'deepseek-chat',
    keyUrl: 'https://platform.deepseek.com/api_keys',
    supportsVision: false,
    requiresKey: true,
  },
  mistral: {
    id: 'mistral',
    label: 'Mistral',
    short: 'Mistral',
    kind: 'openai',
    baseUrl: 'https://api.mistral.ai/v1',
    models: ['mistral-small-latest', 'mistral-large-latest', 'open-mistral-nemo'],
    defaultModel: 'mistral-small-latest',
    freeTier: 'Free “Experiment” plan, but it lets Mistral train on your prompts — think twice with financial data.',
    keyUrl: 'https://console.mistral.ai/api-keys',
    supportsVision: false,
    requiresKey: true,
  },
  xai: {
    id: 'xai',
    label: 'xAI Grok',
    short: 'Grok',
    kind: 'openai',
    baseUrl: 'https://api.x.ai/v1',
    models: ['grok-3-mini', 'grok-2-1212'],
    defaultModel: 'grok-3-mini',
    keyUrl: 'https://console.x.ai',
    supportsVision: false,
    requiresKey: true,
  },
  together: {
    id: 'together',
    label: 'Together AI',
    short: 'Together',
    kind: 'openai',
    baseUrl: 'https://api.together.xyz/v1',
    models: ['meta-llama/Llama-3.3-70B-Instruct-Turbo', 'Qwen/Qwen2.5-72B-Instruct-Turbo'],
    defaultModel: 'meta-llama/Llama-3.3-70B-Instruct-Turbo',
    keyUrl: 'https://api.together.ai/settings/api-keys',
    supportsVision: false,
    requiresKey: true,
  },
  cerebras: {
    id: 'cerebras',
    label: 'Cerebras',
    short: 'Cerebras',
    kind: 'openai',
    baseUrl: 'https://api.cerebras.ai/v1',
    models: ['gpt-oss-120b', 'zai-glm-4.7'],
    defaultModel: 'gpt-oss-120b',
    freeTier: 'Free key with a large daily token allowance; text only.',
    keyUrl: 'https://cloud.cerebras.ai',
    supportsVision: false,
    requiresKey: true,
  },
  ollama: {
    id: 'ollama',
    label: 'Ollama (local)',
    short: 'Ollama',
    kind: 'openai',
    baseUrl: 'http://localhost:11434/v1',
    models: ['llama3.2', 'qwen2.5:7b', 'mistral', 'gemma3'],
    defaultModel: 'llama3.2',
    supportsVision: false,
    requiresKey: false,
    notes: 'Runs on your machine. On a phone, localhost points at the phone — use your computer’s LAN IP instead.',
  },
  custom: {
    id: 'custom',
    label: 'Custom (OpenAI-compatible)',
    short: 'Custom',
    kind: 'openai',
    baseUrl: 'http://localhost:8080/v1',
    models: [],
    defaultModel: 'llama-3.1-8b-instruct',
    supportsVision: true,
    requiresKey: false,
    notes: 'LM Studio, vLLM, LiteLLM, a proxy… any /chat/completions endpoint.',
  },
}

export const PROVIDER_ORDER: ProviderId[] = [
  'google',
  'openai',
  'anthropic',
  'openrouter',
  'groq',
  'deepseek',
  'mistral',
  'xai',
  'together',
  'cerebras',
  'ollama',
  'custom',
]

export function createProfile(provider: ProviderId, priority: number): AIProfile {
  const def = PROVIDERS[provider]
  const at = nowISO()
  return {
    id: uid('p_'),
    name: def.label,
    provider,
    apiKey: '',
    baseUrl: def.baseUrl,
    model: def.defaultModel,
    fallbackModels: def.fallbackModels,
    enabled: true,
    priority,
    health: { status: 'unknown' },
    createdAt: at,
    updatedAt: at,
  }
}

export function profileLabel(profile: AIProfile): string {
  return profile.name?.trim() || PROVIDERS[profile.provider]?.short || 'AI profile'
}

export function canUseProfile(profile: AIProfile): boolean {
  const def = PROVIDERS[profile.provider]
  if (!profile.enabled) return false
  if (!profile.model?.trim()) return false
  if (def.requiresKey && !profile.apiKey?.trim()) return false
  return true
}

export function supportsVision(profile: AIProfile): boolean {
  if (PROVIDERS[profile.provider]?.supportsVision) return true
  // Some otherwise text-only providers host a vision model.
  return /llama-4|vision|-vl\b|pixtral/i.test(profile.model)
}

/** Free backups worth adding next to Gemini, in order of usefulness. */
export const FREE_BACKUPS: ProviderId[] = ['groq', 'openrouter', 'cerebras', 'mistral']

/** Native PDF input: Gemini (inline data), Claude (document blocks), OpenAI (file parts). */
export function supportsPdf(profile: AIProfile): boolean {
  return ['google', 'anthropic', 'openai'].includes(profile.provider)
}
