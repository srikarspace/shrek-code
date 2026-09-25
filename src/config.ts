import { configPath } from './paths'
import { DEFAULT_MODEL } from './llm/models'

/** Worked out once at startup, then passed down by argument. */
export type Config = {
  model: string
  /** undefined when nothing supplied a key. */
  apiKey: string | undefined
  baseURL: string
  debug: boolean
}

/** Layer 1. What a fresh clone with no file and no env vars gets. */
export const DEFAULTS = {
  model: DEFAULT_MODEL,
  baseURL: 'https://openrouter.ai/api/v1',
  debug: false,
} as const

/** An env value, where empty or blank counts as not set. Round 4. */
function envStr(name: string): string | undefined {
  const value = process.env[name]?.trim()
  return value ? value : undefined
}

/** An env on/off switch. `1`, `true` and `yes` mean on. */
function envFlag(name: string): boolean | undefined {
  const value = envStr(name)?.toLowerCase()
  if (value === undefined) return undefined
  return value === '1' || value === 'true' || value === 'yes'
}

/** A file value, where null, blank and non-strings all count as not set. Round 5. */
function pick(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

/** Layer 2. Every key optional, exactly like the settings examples. */
type FileConfig = { model?: unknown; apiKey?: unknown; baseURL?: unknown; debug?: unknown }

/**
 * Read `~/.shrek/config.json`. Missing is the normal first run and gives `{}`.
 * A file that exists and will not parse is an error that names the path,
 * because `JSON.parse` tells you what broke and never which file it was in.
 */
async function readFileLayer(path: string): Promise<FileConfig> {
  const file = Bun.file(path)
  if (!(await file.exists())) return {}

  let parsed: unknown
  try {
    parsed = JSON.parse(await file.text())
  } catch (error) {
    throw new Error(`${path}: ${error instanceof Error ? error.message : String(error)}`)
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(`${path}: expected a JSON object`)
  }
  return parsed as FileConfig
}

/** Work out every setting once. Env beats file beats default. */
export async function loadConfig(): Promise<Readonly<Config>> {
  const file = await readFileLayer(configPath())

  return Object.freeze({
    model: envStr('SHREK_MODEL') ?? pick(file.model) ?? DEFAULTS.model,
    apiKey: envStr('OPENROUTER_API_KEY') ?? pick(file.apiKey),
    baseURL: envStr('SHREK_BASE_URL') ?? pick(file.baseURL) ?? DEFAULTS.baseURL,
    debug:
      envFlag('SHREK_DEBUG') ??
      (typeof file.debug === 'boolean' ? file.debug : undefined) ??
      DEFAULTS.debug,
  })
}
