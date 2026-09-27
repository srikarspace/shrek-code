/** One row: what to send, how much it can hold, what it costs. */
export type ModelInfo = {
  id: string
  /** How many tokens of conversation it can hold at once. */
  context: number
  /** USD per input token. */
  inputPerToken: number
  /** USD per output token. */
  outputPerToken: number
  /** Free ids end in `:free` and are rate limited. */
  free: boolean
}

/** The default. Free, can use tools, good enough for Phases 0 to 15. */
export const DEFAULT_MODEL = 'nvidia/nemotron-3-super-120b-a12b:free'

/** [id, context tokens, USD per 1M in, USD per 1M out], as the pricing page quotes it. */
const TABLE: [string, number, number, number][] = [
  ['qwen/qwen3.8-27b:free', 262_144, 0, 0],
  ['qwen/qwen3-coder-30b-a3b-instruct', 262_144, 0.07, 0.28],
  ['z-ai/glm-4.7-flash', 200_000, 0.06, 0.4],
  ['qwen/qwen3.8-flash', 1_000_000, 0.15, 0.47],
  ['nvidia/nemotron-3-super-120b-a12b:free', 262_144, 0, 0],
  ['google/gemma-4-31b-it:free', 262_144, 0, 0],
  ['cohere/north-mini-code:free', 256_000, 0, 0],
  ['poolside/laguna-s-2.1:free', 262_144, 0, 0],
]

export const MODELS: Record<string, ModelInfo> = Object.fromEntries(
  TABLE.map(([id, context, inPerM, outPerM]) => [
    id,
    {
      id,
      context,
      inputPerToken: inPerM / 1_000_000,
      outputPerToken: outPerM / 1_000_000,
      free: id.endsWith(':free'),
    },
  ]),
)

/** Free ids to switch to when the default starts refusing you. */
export const FREE_FALLBACKS: readonly string[] = Object.values(MODELS)
  .filter((m) => m.free && m.id !== DEFAULT_MODEL)
  .map((m) => m.id)

/** A row, or undefined for an id shrek has never heard of. */
export function lookupModel(id: string): ModelInfo | undefined {
  return MODELS[id]
}

/** USD for one request. Phase 7 calls this with the numbers the API returns. */
export function costOf(info: ModelInfo, inputTokens: number, outputTokens: number): number {
  return inputTokens * info.inputPerToken + outputTokens * info.outputPerToken
}
