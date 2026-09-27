import { mkdir, appendFile } from 'node:fs/promises'
import { join } from 'node:path'
import { projectDir } from '../paths'

/** A file you can only append to. `write` returns once the line is on disk. */
export type Transcript = {
  sessionId: string
  path: string
  write(type: string, fields: Record<string, unknown>): Promise<void>
}

/** Start a new session file under `~/.shrek/projects/<slug>/`. */
export async function openTranscript(cwd: string = process.cwd()): Promise<Transcript> {
  const sessionId = crypto.randomUUID()
  const dir = projectDir(cwd)
  await mkdir(dir, { recursive: true })
  const path = join(dir, `${sessionId}.jsonl`)

  async function write(type: string, fields: Record<string, unknown>): Promise<void> {
    const line = {
      type,
      uuid: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      sessionId,
      ...fields,
    }
    await appendFile(path, `${JSON.stringify(line)}\n`, 'utf8')
  }

  await write('session', { cwd, argv: process.argv.slice(2) })
  return { sessionId, path, write }
}