import { z } from 'zod'
import { stat } from 'node:fs/promises'
import { join, relative } from 'node:path'
import type { Tool } from './types'
import { resolveInside, SKIP } from './guards'

const MAX_RESULTS = 200

const params = z.object({
  pattern: z
    .string()
    .describe('A glob pattern such as **/*.ts or src/**/*.test.ts. ** matches any depth of directory.'),
  path: z.string().optional().describe('Directory to search in. Defaults to the project directory.'),
})

export const glob: Tool<z.infer<typeof params>> = {
  name: 'Glob',
  description:
    'Find files by name using a glob pattern, most recently modified first. ' +
    'Use this to locate a file when you know part of its name or its extension. ' +
    'It returns paths only and never file contents, and it skips node_modules, .git and dist. ' +
    'Use Grep instead to find files by what is inside them.',
  params,
  renderLine: ({ pattern, path }) => `Glob(${pattern}${path ? `, ${path}` : ''})`,

  async execute({ pattern, path }, ctx) {
    const root = resolveInside(ctx.cwd, path ?? '.')

    const found: string[] = []
    for await (const rel of new Bun.Glob(pattern).scan({ cwd: root, onlyFiles: true })) {
      if (!SKIP.test(rel)) found.push(rel)
    }
    if (found.length === 0) return `(no files match ${pattern})`

    const timed = await Promise.all(
      found.map(async (rel) => ({ rel, mtime: (await stat(join(root, rel))).mtimeMs })),
    )
    timed.sort((a, b) => b.mtime - a.mtime)

    const shown = timed.slice(0, MAX_RESULTS).map(({ rel }) => relative(ctx.cwd, join(root, rel)))
    const extra = timed.length - shown.length
    return extra > 0
      ? `${shown.join('\n')}\n... ${extra} more matches, narrow the pattern`
      : shown.join('\n')
  },
}