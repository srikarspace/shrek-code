import { z } from 'zod'
import { join } from 'node:path'
import type { Tool, ToolContext } from './types'
import { MAX_FILE_BYTES, resolveInside, SKIP, truncate } from './guards'

const MODES = ['files_with_matches', 'content', 'count'] as const

const params = z.object({
  pattern: z.string().describe('A regular expression, in ripgrep syntax.'),
  path: z.string().optional().describe('File or directory to search. Defaults to the project directory.'),
  glob: z.string().optional().describe('Only search files matching this glob, such as *.ts.'),
  '-i': z.boolean().optional().describe('Match case insensitively.'),
  output_mode: z
    .enum(MODES)
    .optional()
    .describe(
      'files_with_matches returns one path per matching file and is the default. ' +
        'content returns every matching line as path:line:text. ' +
        'count returns path:count per file. Prefer files_with_matches, then Read what you need.',
    ),
})

type Args = z.infer<typeof params>
type Mode = (typeof MODES)[number]

const RG_FLAG: Record<Mode, string> = {
  files_with_matches: '--files-with-matches',
  content: '--line-number',
  count: '--count',
}

/** Both engines walk the tree in their own order. Group by file so the model sees a stable list. */
function stable(lines: string[]): string[] {
  return [...lines].sort((a, b) => {
    const [pathA = ''] = a.split(':')
    const [pathB = ''] = b.split(':')
    return pathA === pathB ? 0 : pathA < pathB ? -1 : 1
  })
}

async function withRipgrep(rg: string, args: Args, mode: Mode, root: string, ctx: ToolContext) {
  const argv = [rg, RG_FLAG[mode], '--no-messages', '--color=never']
  if (args['-i']) argv.push('--ignore-case')
  if (args.glob) argv.push('--glob', args.glob)
  argv.push('--regexp', args.pattern, '.')

  const proc = Bun.spawn(argv, { cwd: root, stdout: 'pipe', stderr: 'pipe', signal: ctx.signal })
  const [out, err] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ])
  await proc.exited

  // 0 means matches, 1 means none, anything above is a real failure.
  if (proc.exitCode !== null && proc.exitCode > 1) {
    throw new Error(`ripgrep failed: ${err.trim()}`)
  }
  const text = out.trim().replace(/^\.\//gm, '')
  return text === '' ? [] : text.split('\n')
}

async function withJavaScript(args: Args, mode: Mode, root: string) {
  const re = new RegExp(args.pattern, args['-i'] ? 'i' : '')
  const lines: string[] = []
  // ripgrep matches a glob with no slash against the file name at any depth. Bun.Glob does not.
  const pattern = !args.glob ? '**/*' : args.glob.includes('/') ? args.glob : `**/${args.glob}`

  for await (const rel of new Bun.Glob(pattern).scan({ cwd: root, onlyFiles: true })) {
    if (SKIP.test(rel)) continue
    const file = Bun.file(join(root, rel))
    if (file.size > MAX_FILE_BYTES) continue

    const text = await file.text()
    if (!re.test(text)) continue
    if (mode === 'files_with_matches') {
      lines.push(rel)
      continue
    }

    const hits = text.split('\n').flatMap((line, i) => (re.test(line) ? [`${rel}:${i + 1}:${line}`] : []))
    if (mode === 'count') lines.push(`${rel}:${hits.length}`)
    else lines.push(...hits)
  }
  return lines
}

export const grep: Tool<Args> = {
  name: 'Grep',
  description:
    'Search the contents of files with a regular expression. ' +
    'Use this to find where something is defined or used, instead of reading files one by one. ' +
    'Start with the default output_mode, which returns only the paths, then Read the files that ' +
    'look relevant.',
  params,
  renderLine: (args) => `Grep(${args.pattern}${args.path ? `, ${args.path}` : ''})`,

  async execute(args, ctx) {
    const mode = args.output_mode ?? 'files_with_matches'
    const root = resolveInside(ctx.cwd, args.path ?? '.')
    const rg = process.env.SHREK_GREP === 'js' ? null : Bun.which('rg')

    const lines = rg
      ? await withRipgrep(rg, args, mode, root, ctx)
      : await withJavaScript(args, mode, root)

    if (lines.length === 0) return `(no matches for ${args.pattern})`
    return truncate(stable(lines).join('\n'))
  },
}