import { isAbsolute, resolve, sep } from 'node:path'

/** Bigger than this and Read refuses rather than truncating. About 4,000 lines of code. */
export const MAX_FILE_BYTES = 256_000

/** The cap on what any one tool may return, matching the number `bash.ts` uses. */
export const MAX_OUTPUT = 50_000

/** Folders no tool should ever walk into. Part b's Glob and Grep use it too. */
export const SKIP = /(^|\/)(node_modules|\.git|dist|\.shrek|\.next)(\/|$)/

/**
 * A model-supplied path as an absolute one inside `cwd`, or a throw.
 * `dispatch` turns the throw into a tool result. The chapter calls this `safe_path`.
 */
export function resolveInside(cwd: string, p: string): string {
  const root = resolve(cwd)
  const full = isAbsolute(p) ? resolve(p) : resolve(root, p)
  if (full !== root && !full.startsWith(root + sep)) {
    throw new Error(`path escapes the workspace: ${p}`)
  }
  return full
}

/** Cut long output and say how much was dropped, so the model knows it is partial. */
export function truncate(text: string, limit: number = MAX_OUTPUT): string {
  if (text.length <= limit) return text
  return `${text.slice(0, limit)}\n... truncated, ${text.length - limit} more characters`
}
