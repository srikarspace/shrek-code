# Phase 2b: search, parallel calls and tests

About an hour. Two new tools, three files replaced, one test file.

---

## The big picture

After 2a the model can read, write and edit any file **you name for it**. It cannot find a file on
its own, cannot search inside files, and runs its tool calls one after another.

After 2b:

```sh
shrek -p "which files mention slugifyCwd, and what do they do with it?"
```

shrek greps the project, gets the paths back, reads them all at once, and answers. You never named a
file. That is the jump from "edits files" to "works on a codebase".

What later phases build on this: Phase 3 shows the parallel calls as spinners side by side. Phase 4
puts a permission check in front of every tool, and the tests you write today tell you if it breaks
one. Phase 9's sub-agents are mostly Grep and Read in a loop.

## Files

| File | Job |
|---|---|
| `src/tools/glob.ts` | new: find files by name pattern, newest first |
| `src/tools/grep.ts` | new: find text inside files (ripgrep, or plain JS if it is missing) |
| `src/agent/loop.ts` | replaced: run a batch of calls at once, answer them in order, time each one |
| `src/agent/systemPrompt.ts` | replaced: one new line telling the model to search first |
| `bin/shrek.ts` | replaced: register the two new tools, write timings and the turn's end to the transcript |
| `tests/tools.test.ts` | new: every tool and error path, no model, no network |

TypeScript help for this phase: [`learn/ts/phase-2b.md`](./ts/phase-2b.md).

---

## Remember this

> When the model asks for three things at once, shrek starts all three at once, but writes the
> three answers back **in the order they were asked**. `Promise.all` gives you that for free: it
> returns results in input order, not finish order. And because `dispatch` never throws, one failed
> call can't wipe out the other two answers.
>
> **Run in parallel, answer in order.**

---

## Why

**Search saves tokens, not just time.** Without Grep the model finds things with `cat` through Bash,
pasting whole files into the conversation to look at four lines. Every one of those lines is paid
for again on every later request.

**The cheap answer is the default.** Grep has three output modes: file paths only, matching lines,
or counts per file. On a common word in a real repo, "matching lines" can be 100,000 tokens.
"Paths only" is a few hundred. So paths is the default and the model Reads what it picks.

**Order of the list is part of the tool.** The model reads the top of a list and stops. Glob sorts
newest first because the files a task is about are usually the ones touched recently.

**Tools are the part you can test.** The loop needs a model and a network. A tool is just
"arguments and a folder in, string out". So that is where the tests go.

---

## Worked example

The model asks for three things in one reply:

```ts
tool_calls: [
  { id: 'call_A', function: { name: 'Read', arguments: '{"file_path":"src/a.ts"}' } },
  { id: 'call_B', function: { name: 'Grep', arguments: '{"pattern":"slugify"}' } },
  { id: 'call_C', function: { name: 'Read', arguments: '{"file_path":"src/b.ts"}' } },
]
```

The Reads take 1ms each. The Grep takes 40ms.

### Round 1: what finishes when, and what order goes into the array?

<details><summary>Predict, then open</summary>

They **finish** A, C, B. They must be **appended** A, B, C, the order the model asked.

The tempting code pushes results as they finish:

```ts
const results: ToolResult[] = []
await Promise.all(calls.map(async (call) => {
  results.push(await registry.dispatch(call, ctx))   // completion order: A, C, B
}))
```

Nothing errors. Every id is answered, so the API accepts it. But the conversation no longer matches
what the model asked, and it can pin the wrong output on the wrong file.

The fix is to let `Promise.all` build the array:

```ts
const results = await Promise.all(calls.map((call) => registry.dispatch(call, ctx)))
```

`results[1]` is B's result even though B finished last.
</details>

### Round 2: B fails. What does the array look like?

<details><summary>Predict, then open</summary>

If `dispatch` could throw, `Promise.all` would reject on B and the code that appends results would
never run. The array would end with an assistant message holding three calls and zero answers, and
every later request would get a 400.

But since 2a, `dispatch` catches everything and returns `{ isError: true, output: 'Error: ...' }`.
So B's failure is just an ordinary item in `results`, A and C are untouched, and the model reads
the error and tries something else. That is why the loop below has no `try`.
</details>

---

## Your task

Six steps. Keep `bunx tsc --noEmit --watch` running in a second terminal.

### 1. src/tools/glob.ts

**Why.** Without this the model cannot find a file unless you name it. Read's "does not exist"
error already tells it to use Glob.

```ts
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
```

*TypeScript here: [`for await` over an async iterable](./ts/phase-2b.md#ts-1) ·
[`Promise.all` over a mapped array](./ts/phase-2b.md#ts-2).*

- `b.mtime - a.mtime` is newest first. The other way round is a silent bug; step 5 has a test for it.
- The cap message tells the model what to do next ("narrow the pattern"), same idea as 2a's errors.

### 2. src/tools/grep.ts

**Why.** This is how the model finds anything it can't guess the filename of. ripgrep (`rg`) is a
fast search program that respects `.gitignore`, but many machines don't have it, so there is a
plain JavaScript fallback. The model is never told which one ran.

```ts
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
```

*TypeScript here: [`as const` on a tuple, then `z.enum`](./ts/phase-2b.md#ts-3) ·
[a property name that is not an identifier](./ts/phase-2b.md#ts-4) ·
[`Record<Mode, string>` as an exhaustive table](./ts/phase-2b.md#ts-5).*

- ripgrep's **exit code** (the number a program returns when it ends) 1 means "no matches", not
  "failed". Only above 1 is an error.
- `--regexp` before the pattern stops a pattern like `-rf` being read as a flag.
- No `g` flag on the `RegExp`. With `g`, calling `.test` repeatedly skips every other match.
- `SHREK_GREP=js` forces the fallback, so the test can check both engines agree.
- `glob: '*.ts'` means "any `.ts` file, any depth" to ripgrep but "top level only" to `Bun.Glob`.
  The fallback adds `**/` to a glob with no `/` so both engines answer the same.

### 3. src/agent/systemPrompt.ts

**Why.** A tool the model is never nudged toward is a tool it ignores. One new line.

```ts
/** The standing instructions, rebuilt each run because `cwd` and the date change. */
export function systemPrompt(cwd: string): string {
  return [
    `You are shrek, a coding agent running in a terminal at ${cwd} on ${process.platform}.`,
    `Today is ${new Date().toISOString().slice(0, 10)}.`,
    '',
    'Use the tools to find things out. Never guess about the contents of this machine',
    'and never describe a change you could simply make.',
    '',
    'Prefer the file tools over the shell: Read instead of cat, Write instead of a redirect,',
    'Edit instead of sed. Use Bash for everything else, such as running builds and tests.',
    'Use Glob to find files by name and Grep to find them by contents, before reading anything.',
    '',
    'When you have the answer, give it in one or two short lines with no preamble.',
  ].join('\n')
}
```

### 4. src/agent/loop.ts

**Why.** Grep and Bash can take seconds. Running a batch one by one makes the user wait for the sum;
running them together makes them wait for the slowest.

Two changes. The tool-call section is now one loop of `yield`s, one `Promise.all`, one loop of
appends. And every message goes into the transcript with a `MessageMeta` next to it: which step,
which model, tokens used, how long it took. The message array the model sees stays clean; the facts
are for you, reading the JSONL later to see where a turn spent its time.

```ts
import type OpenAI from 'openai'
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions'
import type { AgentEvent, TurnCompleteReason } from './events'
import { systemPrompt } from './systemPrompt'
import { debug } from '../log'
import type { Registry } from '../tools/registry'
import type { ToolContext } from '../tools/types'

export type RunOptions = {
  client: OpenAI
  model: string
  registry: Registry
  prompt: string
  cwd?: string
  /** The cap. Twenty rounds is more than any sane task needs. */
  maxSteps?: number
  signal?: AbortSignal
  /** Called for every message added to the array, in order. The transcript writer. */
  onMessage?: (message: ChatCompletionMessageParam, meta?: MessageMeta) => Promise<void>
}

/** Facts about a message that are not part of it: what it cost, how long it took. */
export type MessageMeta = {
  step?: number
  model?: string
  usage?: unknown
  latencyMs?: number
  isError?: boolean
  durationMs?: number
}

export async function* runAgent(opts: RunOptions): AsyncGenerator<AgentEvent, void, void> {
  const cwd = opts.cwd ?? process.cwd()
  const maxSteps = opts.maxSteps ?? 20
  const signal = opts.signal ?? new AbortController().signal
  const turnId = crypto.randomUUID()
  const startedAt = Date.now()

  const schemas = opts.registry.toOpenAITools()
  const ctx: ToolContext = { cwd, signal, readFiles: new Set() }

  const messages: ChatCompletionMessageParam[] = []
  async function add(message: ChatCompletionMessageParam, meta?: MessageMeta): Promise<void> {
    messages.push(message)
    await opts.onMessage?.(message, meta)
  }

  await add({ role: 'system', content: systemPrompt(cwd) })
  await add({ role: 'user', content: opts.prompt })

  yield { type: 'turn.start', turnId, text: opts.prompt }

  let answer = ''
  let reason: TurnCompleteReason = 'answer'

  try {
    for (let step = 1; step <= maxSteps; step++) {
      if (signal.aborted) {
        reason = 'aborted'
        yield { type: 'turn.abort', turnId }
        break
      }

      await debug('request', { model: opts.model, step, messages })
      const requestedAt = Date.now()
      const response = await opts.client.chat.completions.create(
        { model: opts.model, messages, tools: schemas, max_tokens: 8000 },
        { signal },
      )
      await debug('response', response)

      const message = response.choices[0]?.message
      if (!message) throw new Error('the model returned no choices')
      await add(message, {
        step,
        model: response.model,
        usage: response.usage,
        latencyMs: Date.now() - requestedAt,
      })

      if (message.content) {
        answer = message.content
        yield { type: 'turn.step', turnId, step, kind: 'text', text: message.content }
      }

      const calls = message.tool_calls ?? []
      if (calls.length === 0) break

      for (const call of calls) {
        const { name, line } = opts.registry.renderCall(call)
        yield { type: 'turn.step', turnId, step, kind: 'tool', id: call.id, name, line }
      }

      // Each call times itself, so a slow Grep doesn't make its batch-mates look slow in the log.
      const results = await Promise.all(
        calls.map(async (call) => {
          const calledAt = Date.now()
          const result = await opts.registry.dispatch(call, ctx)
          return { ...result, durationMs: Date.now() - calledAt }
        }),
      )

      for (const result of results) {
        await add(
          { role: 'tool', tool_call_id: result.id, content: result.output },
          { step, isError: result.isError, durationMs: result.durationMs },
        )
        yield { type: 'turn.step', turnId, step, kind: 'result', id: result.id, output: result.output }
      }

      if (step === maxSteps) reason = 'max_steps'
    }
  } catch (error) {
    reason = signal.aborted ? 'aborted' : 'error'
    answer = error instanceof Error ? error.message : String(error)
    await debug('error', { message: answer })
  }

  yield {
    type: 'turn.complete',
    turnId,
    answer,
    durationMs: Date.now() - startedAt,
    isAborted: reason === 'aborted',
    reason,
  }
}
```

*TypeScript here: [`Promise.all` over a mapped array](./ts/phase-2b.md#ts-2).*

- All display lines go out first, so you see every call before any finishes.
- An `await` inside the first loop would make it sequential again. That's why it is three passes.
- Appends stay in a plain `for`: transcript writes must not interleave (Phase 1b's rule).
- Each call starts its own clock inside the `map`. One clock around the whole `Promise.all` would
  give every call in the batch the slowest one's time.

### 5. bin/shrek.ts

**Why.** A tool exists for the model only once it is in the registry. Two imports, two words in an
array. Nothing in the loop changes for that, which is the whole point of 2a's registry.

```ts
#!/usr/bin/env bun
import pkg from '../package.json'
import { loadConfig, type Config } from '../src/config'
import { createClient, keyStatus } from '../src/llm/client'
import { lookupModel } from '../src/llm/models'
import { ensureStateDir, stateDir } from '../src/paths'
import { runAgent } from '../src/agent/loop'
import { enableDebug } from '../src/log'
import { openTranscript } from '../src/session/jsonl'
import { createRegistry } from '../src/tools/registry'
import { bash } from '../src/tools/bash'
import { read } from '../src/tools/read'
import { write } from '../src/tools/write'
import { edit } from '../src/tools/edit'
import { glob } from '../src/tools/glob'
import { grep } from '../src/tools/grep'

const registry = createRegistry([bash, read, write, edit, glob, grep])

function versionLines(config: Config): string[] {
  const info = lookupModel(config.model)
  const note = info
    ? `${Math.round(info.context / 1000)}k ctx, ${info.free ? 'free' : 'paid'}`
    : 'unknown to registry, no cost tracking'

  return [
    `shrek ${pkg.version}`,
    `model: ${config.model} (${note})`,
    `key: ${keyStatus(config)}`,
    `state: ${stateDir()}`,
  ]
}

async function runPrint(config: Config, prompt: string): Promise<number> {
  const client = createClient(config)
  const controller = new AbortController()
  process.on('SIGINT', () => controller.abort())
  const transcript = await openTranscript()

  for await (const event of runAgent({
    client,
    model: config.model,
    registry,
    prompt,
    signal: controller.signal,
    onMessage: (message, meta) => transcript.write('message', { message, ...meta }),
  })) {
    if (event.type === 'turn.step' && event.kind === 'tool') console.error(event.line)

    if (event.type === 'turn.complete') {
      const { type, ...fields } = event
      await transcript.write(type, fields)
      if (event.reason === 'answer') {
        console.log(event.answer)
        return 0
      }
      console.error(`shrek: turn ended with ${event.reason}: ${event.answer}`)
      return 1
    }
  }
  return 1
}

async function main(argv: string[]): Promise<number> {
  const config = await loadConfig()
  await ensureStateDir()
  enableDebug(config.debug || argv.includes('--debug'))

  if (argv.includes('--version') || argv.includes('-v')) {
    for (const line of versionLines(config)) console.log(line)
    return 0
  }

  const flag = argv.findIndex((a) => a === '-p' || a === '--print')
  if (flag !== -1) {
    const prompt = argv[flag + 1]
    if (!prompt) {
      console.error('usage: shrek -p "your question"')
      return 1
    }
    return runPrint(config, prompt)
  }

  console.error('usage: shrek --version | shrek -p "your question"')
  return 1
}

const code = await main(process.argv.slice(2)).catch((error: unknown) => {
  console.error(`shrek: ${error instanceof Error ? error.message : String(error)}`)
  return 1
})

process.exit(code)
```

- `onMessage` now takes the meta too and spreads it beside the message, so each JSONL line reads
  `{ type, message, step, durationMs, ... }`. Spreading `undefined` adds nothing, so the system and
  user messages, which have no meta, still write fine.
- The `turn.complete` event goes into the transcript as its own line: the answer, why the turn
  ended, and the total time.

### 6. tests/tools.test.ts

**Why.** Six tools, about fifteen error paths. This checks them all in under a second with no key,
and it will tell you when Phase 4 or 5 breaks one. Create the `tests/` folder first.

```ts
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ToolContext } from '../src/tools/types'
import { resolveInside } from '../src/tools/guards'
import { createRegistry } from '../src/tools/registry'
import { read } from '../src/tools/read'
import { write } from '../src/tools/write'
import { edit } from '../src/tools/edit'
import { glob } from '../src/tools/glob'
import { grep } from '../src/tools/grep'

let dir = ''

/** A fresh context per test, so one test's Read cannot unlock another test's Edit. */
function ctx(): ToolContext {
  return { cwd: dir, signal: new AbortController().signal, readFiles: new Set() }
}

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'shrek-'))
  await mkdir(join(dir, 'src'), { recursive: true })
  await writeFile(join(dir, 'src/a.ts'), 'const x = 1\nconst y = 1\n')
  await writeFile(join(dir, 'src/b.ts'), 'export const name = "shrek"\n')
  // Glob sorts by modification time, so set them rather than trusting write order.
  await utimes(join(dir, 'src/a.ts'), new Date(1_000_000), new Date(1_000_000))
  await utimes(join(dir, 'src/b.ts'), new Date(2_000_000), new Date(2_000_000))
})

afterAll(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('Read', () => {
  test('numbers every line and records the resolved path', async () => {
    const c = ctx()
    const out = await read.execute({ file_path: 'src/a.ts' }, c)
    expect(out).toBe('     1\tconst x = 1\n     2\tconst y = 1\n     3\t')
    expect(c.readFiles.has(join(dir, 'src/a.ts'))).toBe(true)
  })

  test('offset and limit page through the file', async () => {
    const out = await read.execute({ file_path: 'src/a.ts', offset: 2, limit: 1 }, ctx())
    expect(out).toBe('     2\tconst y = 1\n... 1 more lines')
  })

  test('a missing file is a result, not a throw', async () => {
    const out = await read.execute({ file_path: 'nope.ts' }, ctx())
    expect(out).toStartWith('Error: nope.ts does not exist')
  })
})

describe('Write', () => {
  test('creates missing parents and says what it did', async () => {
    const c = ctx()
    const out = await write.execute({ file_path: 'a/b/c.txt', content: 'hi\n' }, c)
    expect(out).toBe('Created a/b/c.txt, 3 bytes, 2 lines')
    expect(await Bun.file(join(dir, 'a/b/c.txt')).text()).toBe('hi\n')
  })
})

describe('Edit', () => {
  test('refuses a file that has not been read', async () => {
    const out = await edit.execute(
      { file_path: 'src/a.ts', old_string: 'const x', new_string: 'let x' },
      ctx(),
    )
    expect(out).toStartWith('Error: you have not read src/a.ts')
  })

  test('refuses an ambiguous match, names the count, and changes nothing', async () => {
    const c = ctx()
    await read.execute({ file_path: 'src/a.ts' }, c)
    const out = await edit.execute({ file_path: 'src/a.ts', old_string: 'const', new_string: 'let' }, c)
    expect(out).toContain('appears 2 times')
    expect(await Bun.file(join(dir, 'src/a.ts')).text()).toBe('const x = 1\nconst y = 1\n')
  })

  test('replace_all changes every occurrence', async () => {
    const c = ctx()
    await write.execute({ file_path: 'all.txt', content: 'a\na\na\n' }, c)
    const out = await edit.execute(
      { file_path: 'all.txt', old_string: 'a', new_string: 'b', replace_all: true },
      c,
    )
    expect(out).toStartWith('Edited all.txt, 3 replacements.')
    expect(await Bun.file(join(dir, 'all.txt')).text()).toBe('b\nb\nb\n')
  })

  test('a single match is spliced, so $ has no special meaning', async () => {
    const c = ctx()
    await write.execute({ file_path: 'money.txt', content: 'cost: $5\n' }, c)
    await edit.execute({ file_path: 'money.txt', old_string: '$5', new_string: '$&9' }, c)
    expect(await Bun.file(join(dir, 'money.txt')).text()).toBe('cost: $&9\n')
  })
})

describe('Glob', () => {
  test('returns matches newest first', async () => {
    expect(await glob.execute({ pattern: 'src/*.ts' }, ctx())).toBe('src/b.ts\nsrc/a.ts')
  })

  test('says so when nothing matches', async () => {
    expect(await glob.execute({ pattern: '**/*.py' }, ctx())).toBe('(no files match **/*.py)')
  })
})

describe('Grep', () => {
  test('both engines find the same things', async () => {
    const args = { pattern: 'const x', glob: '*.ts', output_mode: 'content' as const }
    const fromRipgrep = await grep.execute(args, ctx())

    process.env.SHREK_GREP = 'js'
    const fromJavaScript = await grep.execute(args, ctx())
    delete process.env.SHREK_GREP

    expect(fromRipgrep).toContain('src/a.ts:1:const x = 1')
    expect(fromJavaScript).toBe(fromRipgrep)
  })
})

describe('guards and dispatch', () => {
  test('a path outside the workspace throws', () => {
    expect(() => resolveInside(dir, '../escape.txt')).toThrow('escapes the workspace')
  })

  test('dispatch turns a throw into an error result', async () => {
    const registry = createRegistry([read])
    const result = await registry.dispatch(
      {
        id: 'call_1',
        type: 'function',
        function: { name: 'Read', arguments: '{"file_path":"../escape.txt"}' },
      },
      ctx(),
    )
    expect(result.isError).toBe(true)
    expect(result.output).toStartWith('Error: path escapes the workspace')
  })

  test('an unknown tool name comes back with the list of real ones', async () => {
    const registry = createRegistry([read, write])
    const result = await registry.dispatch(
      { id: 'call_2', type: 'function', function: { name: 'read_file', arguments: '{}' } },
      ctx(),
    )
    expect(result.output).toBe('Error: no tool named read_file. Available: Read, Write')
  })

  test('arguments that do not match the schema come back named', async () => {
    const registry = createRegistry([read])
    const result = await registry.dispatch(
      { id: 'call_3', type: 'function', function: { name: 'Read', arguments: '{"file_path":5}' } },
      ctx(),
    )
    expect(result.isError).toBe(true)
    expect(result.output).toStartWith('Error: invalid arguments for Read')
  })
})
```

*TypeScript here: [`bun:test` and what `expect` knows](./ts/phase-2b.md#ts-6).*

- `ctx()` is a function so no test inherits another test's `readFiles`.
- `utimes` sets file times by hand; two quick writes can share a millisecond and make the order random.
- `mkdtemp` instead of `/tmp/...`: on macOS `/tmp` is a link to `/private/tmp`, which trips `resolveInside`.

### 7. Commit

```sh
bun test
bun run typecheck
git add -A
git diff --cached | grep -iE 'sk-or-|api[_-]?key'
git commit -m "phase 2b: glob, grep, parallel calls and tests"
```

---

## Test

```sh
bun test
```

```
 15 pass
 0 fail
Ran 15 tests across 1 file.
```

Then a real task, in a scratch folder (substitute your project path):

```sh
mkdir -p /tmp/shrek-fizz && cd /tmp/shrek-fizz
bun run /Users/youruser/repo/your-agent/bin/shrek.ts -p "write a node script that prints fizzbuzz to 20, run it, fix any bug"
```

Expect tool lines like `Write(fizzbuzz.js, 214 bytes)` then `$ node fizzbuzz.js`, and a short
answer. `node fizzbuzz.js | head -5` prints `1 2 Fizz 4 Buzz`, one per line. If it says
`no OpenRouter key`, Bun only reads `.env` from the current folder; put the key in
`~/.shrek/config.json`.

And the search task, from your project folder:

```sh
bun run bin/shrek.ts -p "which files mention slugifyCwd, and what do they do with it?"
```

```
Grep(slugifyCwd)
Read(src/paths.ts)
```

Two calls, not six Reads.

### Deliberate failure: answers in finish order

In `loop.ts`, swap the `Promise.all` for the "push as they finish" version from round 1 (add
`ToolResult` to the `Registry` import). Then:

```sh
bun run bin/shrek.ts -p "at the same time: read package.json, and run 'sleep 2 && echo done'"
D=~/.shrek/projects/$(printf '%s' "$PWD" | tr -cs 'A-Za-z0-9' '-')
F=$(ls -t "$D"/*.jsonl | head -1)
jq -r 'select(.message.tool_calls) | .message.tool_calls[].id' "$F"
jq -r 'select(.message.role == "tool") | .message.tool_call_id' "$F"
```

Same ids, different order, and no error anywhere. Put `Promise.all` back and the orders match.

- Lists match even with the broken code: the model made one call. Ask for two explicitly.

---

## Gotchas

- **ripgrep exit code 1 = no matches.** Treating it as an error breaks every empty search.
- **`rg` in your shell is not `rg` for Bun.** Claude Code installs `rg` as a zsh *function*, and
  `Bun.which` only sees real files on `PATH`, so it returns `null` and the JS fallback runs. Check
  with `bun -e "console.log(Bun.which('rg'))"`; `brew install ripgrep` if you want the fast path.
  The Grep test then compares the fallback with itself, which is why the glob bug above hid there.
- **`*.ts` is not recursive in `Bun.Glob`.** Only `**/*.ts` is. The echoed pattern in
  `(no files match ...)` is how the model notices.
- **Parallel writes to one file still race.** Nothing stops two Writes to the same path in one batch.
  Phase 4's approval prompt makes it unlikely in practice.
- **Free model loops until `max_steps`.** Retry once, or set
  `SHREK_MODEL=qwen/qwen3-coder-30b-a3b-instruct` for one run. A model limit, not your bug.

---

## Recap

Glob and Grep let the model find code by itself, cheapest answer first. The loop now runs a batch
of calls together and answers them in the order asked. Fifteen tests pin every tool and the
registry's error strings, with no model needed.

1. `Promise.all` rejects on the first failure, yet the loop has no `try` around it. Why is that safe?
2. Why does Grep default to paths only, instead of matching lines?

Next, Phase 3 puts a React terminal UI in front of all this, fed by the same events the loop
already yields.
