import { z } from 'zod'
import type { Tool } from './types'

const params = z.object({
  command: z.string().describe('The shell command to run.'),
})

/** Refused outright. Phase 4 replaces this with a real permission prompt. */
const BLOCKED = [/\brm\s+-rf\s+\/\s*$/, /\bsudo\b/, /\bshutdown\b/, /\breboot\b/, />\s*\/dev\//]

const TIMEOUT_MS = 120_000
const MAX_OUTPUT = 50_000

export const bash: Tool<z.infer<typeof params>> = {
  name: 'Bash',
  description:
    'Run a shell command in the project directory and return its combined stdout and stderr. ' +
    'Use this to run builds, tests, git and other programs. Do not use it to read, create or ' +
    'change files: use Read, Write and Edit for those. ' +
    'The exit code is appended when it is not zero. Commands time out after 120 seconds.',
  params,
  renderLine: ({ command }) => `$ ${command}`,

  async execute({ command }, ctx) {
    if (BLOCKED.some((rule) => rule.test(command))) {
      return `Error: shrek refuses to run this command: ${command}`
    }

    const proc = Bun.spawn(['bash', '-c', command], {
      cwd: ctx.cwd,
      stdout: 'pipe',
      stderr: 'pipe',
      timeout: TIMEOUT_MS,
      killSignal: 'SIGKILL',
      signal: ctx.signal,
    })

    const [out, err] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ])
    await proc.exited

    if (proc.signalCode) {
      return `Error: command killed by ${proc.signalCode} after ${TIMEOUT_MS / 1000}s: ${command}`
    }

    const text = (out + err).trim()
    if (!text) return proc.exitCode === 0 ? '(no output)' : `(no output, exit code ${proc.exitCode})`

    const body =
      text.length > MAX_OUTPUT
        ? `${text.slice(0, MAX_OUTPUT)}\n... truncated, ${text.length - MAX_OUTPUT} more characters`
        : text

    return proc.exitCode === 0 ? body : `${body}\n(exit code ${proc.exitCode})`
  },
}