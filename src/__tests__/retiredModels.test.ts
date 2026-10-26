import { describe, expect, it } from 'vitest'
import { PROVIDERS, liveModel, modelSeesImages } from '../ai/providers'
import type { AIProfile } from '../types'

describe('retired models', () => {
  it('swaps shut-down models for their replacement', () => {
    expect(liveModel('groq', 'meta-llama/llama-4-scout-17b-16e-instruct')).toBe('qwen/qwen3.6-27b')
    expect(liveModel('google', 'gemini-2.0-flash')).toBe('gemini-flash-latest')
    expect(liveModel('google', 'gemini-2.5-flash')).toBe('gemini-2.5-flash')
  })
  it('groq vision model reads images', () => {
    const p = { provider: 'groq', model: 'llama-3.3-70b-versatile' } as AIProfile
    expect(PROVIDERS.groq.visionModel).toBe('qwen/qwen3.6-27b')
    expect(modelSeesImages(p, 'qwen/qwen3.6-27b')).toBe(true)
    expect(modelSeesImages(p, 'openai/gpt-oss-120b')).toBe(false)
  })
})
