import OpenAI from 'openai'
import type { Config } from '../config'

/** Whether shrek has a key. Read from config, never from the SDK. */
export function keyStatus(config: Config): 'ok' | 'missing' {
  return config.apiKey ? 'ok' : 'missing'
}

/**
 * An OpenAI-shaped client pointed at OpenRouter. `apiKey` is passed in on
 * purpose: leave it out and the SDK reads `OPENAI_API_KEY`, builds without
 * complaining, and then 401s on every request.
 */
export function createClient(config: Config): OpenAI {
  if (!config.apiKey) {
    throw new Error(
      'no OpenRouter key. Set OPENROUTER_API_KEY in .env, or "apiKey" in ~/.shrek/config.json',
    )
  }

  return new OpenAI({
    apiKey: config.apiKey,
    baseURL: config.baseURL,
    defaultHeaders: { 'X-Title': 'shrek-code' },
  })
}
