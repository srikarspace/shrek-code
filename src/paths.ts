import { mkdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

/** Root of per-user state. `~/.shrek`, or `$SHREK_STATE_DIR` when set. */
export function stateDir(): string {
  const override = process.env.SHREK_STATE_DIR?.trim()
  return override ? override : join(homedir(), '.shrek')
}

/** `~/.shrek/config.json`, the file layer that `loadConfig` reads. */
export function configPath(): string {
  return join(stateDir(), 'config.json')
}

/** `~/.shrek/logs`, where the Phase 1 debug logger writes. */
export function logsDir(): string {
  return join(stateDir(), 'logs')
}

/**
 * A folder path squashed into one safe folder name. Every run of characters
 * that is not a letter or digit becomes one `-`, so `/Users/ada/repo/shrek`
 * becomes `-Users-ada-repo-shrek`. Same rule real Claude Code uses.
 * Lossy: `/a/b-c` and `/a/b/c` collide.
 */
export function slugifyCwd(cwd: string): string {
  return cwd.replace(/[^A-Za-z0-9]+/g, '-')
}

/** This project's conversation folder. Phase 1 writes logs here. */
export function projectDir(cwd: string = process.cwd()): string {
  return join(stateDir(), 'projects', slugifyCwd(cwd))
}

/** Create the folders. Safe to call on every single start. */
export async function ensureStateDir(cwd: string = process.cwd()): Promise<string> {
  await mkdir(logsDir(), { recursive: true })
  await mkdir(projectDir(cwd), { recursive: true })
  return stateDir()
}
