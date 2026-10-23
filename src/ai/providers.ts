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
    models: ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.5-flash-lite', 'gemini-2.0-flash', 'gemini-1.5-flash'],
    defaultModel: 'gemini-2.5-flash',
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
    models: ['google/gemini-2.5-flash', 'openai/gpt-4o-mini', 'anthropic/claude-sonnet-4.5', 'meta-llama/llama-3.3-70b-instruct'],
    defaultModel: 'google/gemini-2.5-flash',
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
    models: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'openai/gpt-oss-120b'],
    defaultModel: 'llama-3.3-70b-versatile',
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
