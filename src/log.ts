import { appendFile } from 'node:fs/promises'
import { join } from 'node:path'
import { logsDir } from './paths'

let alsoToStderr = false

/** Called once, from `bin/shrek.ts`. */
export function enableDebug(on: boolean): void {
  alsoToStderr = on
}

/** One JSON line in `~/.shrek/logs/shrek.log`. Never throws. */
export async function debug(tag: string, data: unknown): Promise<void> {
  const line = JSON.stringify({ at: new Date().toISOString(), tag, data })
  if (alsoToStderr) process.stderr.write(`${line}\n`)
  try {
    await appendFile(join(logsDir(), 'shrek.log'), `${line}\n`, 'utf8')
  } catch {
    // A broken log must never take down a working agent.
  }
}