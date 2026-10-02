# Phase 2a: the registry and the file tools

About an hour. Five small files and a few edits.

Phase 2 is two sittings. Part a builds the tool registry plus Read, Write and Edit. Part b adds
Glob and Grep, parallel calls, and tests.

---

## The big picture

After Phase 1 shrek has one tool, Bash. To change a line the model writes a `sed` command and
hopes. `sed` differs per platform, silently does nothing when the pattern misses, and breaks on a
stray slash. Nothing tells the model whether the edit landed.

After 2a:

```sh
shrek -p "add a docstring to the top of src/paths.ts"
```

shrek Reads the file, Edits the exact spot, and the tool reports what changed. No shell.

The registry is the bigger change. After today the loop doesn't know how many tools exist, so every
later tool (Glob, Grep, TodoWrite, Task, Skill, MCP tools) is one new file and one word in an array.
Phase 4 puts permissions in front of `dispatch`; Phase 5 turns it into a hook point.

## Files

| File | Job |
|---|---|
| `src/tools/guards.ts` | keep tools inside the project, cut long output |
| `src/tools/registry.ts` | hold the tools, describe them to the model, run one by name |
| `src/tools/types.ts` | replaced: context gains `readFiles` |
| `src/agent/loop.ts` | edit: ask the registry instead of doing it itself |
| `bin/shrek.ts` | edit: build the registry once at startup |
| `src/tools/bash.ts` | edit: stop steering the model to the shell for files |
| `src/tools/read.ts` | return a file with line numbers |
| `src/tools/write.ts` | replace a file whole, creating folders |
| `src/tools/edit.ts` | swap one exact piece of text for another |

TypeScript help for this phase: [`learn/ts/phase-2a.md`](./ts/phase-2a.md).

---

## Remember this

> The model never sees your code. All it knows about a tool is its **name, its description, and
> the error strings it gets back**. So those strings are the real interface. A vague description
> makes the model guess; a vague error makes it repeat the same mistake. A good error names the
> file, the problem, and the next call to make.
>
> **Descriptions and errors are the API the model reads.**

---

## Why

**One registry, one `try`.** Every call goes through `dispatch`: look up the tool, parse the JSON,
check it with Zod, run it inside one `try`. Every failure becomes a tool result, never a throw. One
place to get right instead of one per tool.

**Edit refuses to guess.** If `old_string` appears twice, Edit changes nothing and says "appears 2
times, add more context or pass replace_all". The alternative, changing the first match, reports
success while leaving the file half-edited.

**Read before edit.** Edit refuses a file the model hasn't Read this run. `old_string` must match
byte for byte, and a model working from memory gets the words right and the whitespace wrong.
Reading first puts the exact text right above the Edit call.

**The path guard is a guard rail, not a sandbox.** `resolveInside` stops a confused model wandering
out of the project. Bash ignores it entirely. Phase 4 is the real control.

---

## Worked example

### Round 1: what the model sees

This is the whole Edit tool as the model receives it, with description `Edit a file.`:

```json
{
  "type": "function",
  "function": {
    "name": "Edit",
    "description": "Edit a file.",
    "parameters": {
      "type": "object",
      "properties": {
        "file_path": { "type": "string" },
        "old_string": { "type": "string" },
        "new_string": { "type": "string" },
        "replace_all": { "type": "boolean" }
      },
      "required": ["file_path", "old_string", "new_string"]
    }
  }
}
```

Task: "rename `slugifyCwd` to `slugify` in src/paths.ts". What call would you make, knowing only
this?

<details><summary>Predict, then open</summary>

All of these are reasonable readings, and models send all of them:

```jsonc
{"file_path": "src/paths.ts", "old_string": "slugifyCwd", "new_string": "slugify"}
{"file_path": "src/paths.ts", "old_string": "27", "new_string": "export function slugify(cwd: string): string {"}
{"file_path": "src/paths.ts", "old_string": "export function slugifyCwd", "new_string": "export function slugify"}
```

Is `old_string` a line number? A fragment? Nothing says. The fix is four sentences: match byte for
byte, never include Read's line numbers, must appear exactly once (or pass `replace_all`), Read
first. Step 7 makes you watch the difference.
</details>

### Round 2: four error strings

The model Edits a file it never read. Which reply gets the next call right?

```
A  Error: not read
B  Error: you must read a file before editing it
C  Error: you have not read src/paths.ts in this conversation. Call Read on it first, then Edit it.
```

<details><summary>Predict, then open</summary>

C. It names the **file**, the **problem**, and the **next call**. A has no action. B doesn't say
which file, which matters when three edits are in flight. Check every error you write today
against those three parts.
</details>

---

## Your task

Eight steps. Keep `bunx tsc --noEmit --watch` running.

### 1. src/tools/guards.ts

**Why.** Every file tool needs the same two rules, kept in one place.

```ts
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
```

*TypeScript here: [a function that returns a string or throws](./ts/phase-2a.md#ts-1).*

- `resolve` collapses `..`, so `../../.ssh` becomes an absolute path that fails the check.
- `+ sep` stops `/repo/your-agent-secrets` passing as inside `/repo/your-agent`.

### 2. src/tools/registry.ts, and four lines out of types.ts

**Why.** This is what makes every later tool one file. Phase 5 turns it into `$.tool`.

Replace `src/tools/types.ts` with this (`toOpenAITool` moves into the registry, `ToolContext` gains
`readFiles`):

```ts
import { z } from 'zod'

/** What a tool is allowed to know about the run it is part of. */
export type ToolContext = {
  cwd: string
  /** Aborted when the user hits ctrl-c. Long tools must respect it. */
  signal: AbortSignal
  /** Absolute paths Read has returned this run. Edit refuses a path that is not in here. */
  readFiles: Set<string>
}

/** One capability the model can ask for. `T` is the shape of its arguments. */
export type Tool<T> = {
  name: string
  /** The model reads this to decide when to call it. Phase 2 is about this string. */
  description: string
  /** Validates input, generates the schema, and supplies `T`. One source of truth. */
  params: z.ZodType<T>
  /** What the model sees. Returns a string on every path, including failure. */
  execute(args: T, ctx: ToolContext): Promise<string>
  /** One readable line, like `$ ls src`. Phase 3 renders it. */
  renderLine(args: T): string
}

/** Any tool, for the arrays and maps that hold tools of different shapes. */
export type AnyTool = Tool<any>
```

*TypeScript here: [`Set<string>` on the context](./ts/phase-2a.md#ts-3).*

Now the registry:

```ts
import { z } from 'zod'
import type {
  ChatCompletionFunctionTool,
  ChatCompletionMessageToolCall,
} from 'openai/resources/chat/completions'
import type { AnyTool, ToolContext } from './types'

/** One finished call. `isError` is a fact about the result, never a reason to throw. */
export type ToolResult = { id: string; output: string; isError: boolean }

export type Registry = {
  /** Name and description only, which is all the model is ever given. Phase 5's `$.tool.list()`. */
  list(): { name: string; description: string }[]
  /** The `tools` array sent on every request, built once. */
  toOpenAITools(): ChatCompletionFunctionTool[]
  /** The display line, before the call runs. Phase 3 puts this on screen. */
  renderCall(call: ChatCompletionMessageToolCall): { name: string; line: string }
  /** Runs one call and returns its result. Never throws. */
  dispatch(call: ChatCompletionMessageToolCall, ctx: ToolContext): Promise<ToolResult>
}

/** `undefined` means the model sent something that is not JSON. `JSON.parse` never returns it. */
function parseArguments(raw: string): unknown {
  try {
    return JSON.parse(raw || '{}')
  } catch {
    return undefined
  }
}

function schemaOf(tool: AnyTool): ChatCompletionFunctionTool {
  const parameters = z.toJSONSchema(tool.params) as Record<string, unknown>
  delete parameters.$schema
  return {
    type: 'function',
    function: { name: tool.name, description: tool.description, parameters },
  }
}

export function createRegistry(tools: AnyTool[]): Registry {
  const byName = new Map(tools.map((tool) => [tool.name, tool]))
  const schemas = tools.map(schemaOf)

  return {
    list: () => tools.map(({ name, description }) => ({ name, description })),
    toOpenAITools: () => schemas,

    renderCall(call) {
      if (call.type !== 'function') return { name: call.type, line: `${call.type}(?)` }
      const name = call.function.name
      const tool = byName.get(name)
      if (!tool) return { name, line: `${name}(?)` }
      const parsed = tool.params.safeParse(parseArguments(call.function.arguments))
      return { name, line: parsed.success ? tool.renderLine(parsed.data) : `${name}(?)` }
    },

    async dispatch(call, ctx) {
      const fail = (output: string): ToolResult => ({ id: call.id, output, isError: true })
      if (call.type !== 'function') return fail(`Error: unsupported tool call type ${call.type}`)

      const name = call.function.name
      const tool = byName.get(name)
      if (!tool) {
        return fail(`Error: no tool named ${name}. Available: ${[...byName.keys()].join(', ')}`)
      }

      const raw = parseArguments(call.function.arguments)
      if (raw === undefined) {
        return fail(`Error: arguments for ${name} were not valid JSON: ${call.function.arguments}`)
      }

      const parsed = tool.params.safeParse(raw)
      if (!parsed.success) {
        return fail(`Error: invalid arguments for ${name}: ${parsed.error.message}`)
      }

      try {
        return { id: call.id, output: await tool.execute(parsed.data, ctx), isError: false }
      } catch (error) {
        return fail(`Error: ${error instanceof Error ? error.message : String(error)}`)
      }
    },
  }
}
```

*TypeScript here: [an object of methods as a return value](./ts/phase-2a.md#ts-2) ·
[narrowing `call.type` before `call.function`](./ts/phase-2a.md#ts-4) ·
[`Map.get` and `undefined`](./ts/phase-2a.md#ts-7) · [the `$schema` cast](./ts/phase-2a.md#ts-8).*

- `dispatch` is 1a's `prepare` moved here, plus the one `try`. Every failure becomes a result.
- `no tool named X. Available: ...` lets a model that guessed `read_file` correct itself next round.

### 3. src/agent/loop.ts and bin/shrek.ts, the wiring

**Why.** After this the loop doesn't know how many tools exist.

In `src/agent/loop.ts`, delete `prepare` and `Prepared`, replace the imports, and change the options:

```ts
import type OpenAI from 'openai'
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions'
import type { AgentEvent, TurnCompleteReason } from './events'
import { systemPrompt } from './systemPrompt'
import { debug } from '../log'
import type { Registry } from '../tools/registry'
import type { ToolContext } from '../tools/types'
```

```ts
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
  onMessage?: (message: ChatCompletionMessageParam) => Promise<void>
}
```

Replace the `byName` and `schemas` lines with:

```ts
  const schemas = opts.registry.toOpenAITools()
  const ctx: ToolContext = { cwd, signal, readFiles: new Set() }
```

and the tool-call loop with:

```ts
      for (const call of calls) {
        const { name, line } = opts.registry.renderCall(call)
        yield { type: 'turn.step', turnId, step, kind: 'tool', id: call.id, name, line }

        const result = await opts.registry.dispatch(call, ctx)
        await add({ role: 'tool', tool_call_id: result.id, content: result.output })
        yield { type: 'turn.step', turnId, step, kind: 'result', id: result.id, output: result.output }
      }
```

- `ctx` lives for one run, so `readFiles` remembers what was read this run and nothing longer.

In `bin/shrek.ts`, add imports and build the registry above `main`:

```ts
import { createRegistry } from '../src/tools/registry'
import { bash } from '../src/tools/bash'
import { read } from '../src/tools/read'
import { write } from '../src/tools/write'
import { edit } from '../src/tools/edit'

const registry = createRegistry([bash, read, write, edit])
```

and in `runPrint`:

```ts
  for await (const event of runAgent({
    client,
    model: config.model,
    registry,
    prompt,
    signal: controller.signal,
    onMessage: (message) => transcript.write('message', { message }),
  })) {
```

In `src/agent/systemPrompt.ts`, replace the Bash paragraph:

```ts
    'Use the tools to find things out. Never guess about the contents of this machine',
    'and never describe a change you could simply make.',
    '',
    'Prefer the file tools over the shell: Read instead of cat, Write instead of a redirect,',
    'Edit instead of sed. Use Bash for everything else, such as running builds and tests.',
```

And in `src/tools/bash.ts`, replace the `description`, because Bash still claims it can "read or
change files" and a tool's own description outweighs the system prompt:

```ts
  description:
    'Run a shell command in the project directory and return its combined stdout and stderr. ' +
    'Use this to run builds, tests, git and other programs. Do not use it to read, create or ' +
    'change files: use Read, Write and Edit for those. ' +
    'The exit code is appended when it is not zero. Commands time out after 120 seconds.',
```

The type checker stays red until step 6 creates the three imported files.

### 4. src/tools/read.ts

**Why.** Line numbers to talk about, paging for long files, and Edit's gate depends on it.

```ts
import { z } from 'zod'
import { stat } from 'node:fs/promises'
import type { Tool } from './types'
import { MAX_FILE_BYTES, resolveInside, truncate } from './guards'

const DEFAULT_LIMIT = 2000

const params = z.object({
  file_path: z.string().describe('Path to the file, relative to the project directory or absolute.'),
  offset: z
    .number()
    .int()
    .min(1)
    .optional()
    .describe('First line to return, counting from 1. Use with limit to page through a long file.'),
  limit: z
    .number()
    .int()
    .min(1)
    .optional()
    .describe(`How many lines to return. Defaults to ${DEFAULT_LIMIT}.`),
})

export const read: Tool<z.infer<typeof params>> = {
  name: 'Read',
  description:
    'Read a file from the project and return its contents with a line number on every line. ' +
    'The line numbers are a reading aid and are not part of the file, so never include them in ' +
    'an Edit. Use offset and limit to page through a file longer than 2000 lines. ' +
    'You must Read a file before you can Edit it.',
  params,
  renderLine: ({ file_path }) => `Read(${file_path})`,

  async execute({ file_path, offset, limit }, ctx) {
    const path = resolveInside(ctx.cwd, file_path)

    const info = await stat(path).catch(() => null)
    if (!info) return `Error: ${file_path} does not exist. Use Glob to find the right path.`
    if (info.isDirectory()) {
      return `Error: ${file_path} is a directory. Use Glob with a pattern like ${file_path}/** instead.`
    }
    if (info.size > MAX_FILE_BYTES) {
      return (
        `Error: ${file_path} is ${info.size} bytes, over the ${MAX_FILE_BYTES} byte limit. ` +
        `Use Grep to search it, or offset and limit to read part of it.`
      )
    }

    const text = await Bun.file(path).text()
    ctx.readFiles.add(path)
    if (text === '') return '(file is empty)'

    const lines = text.split('\n')
    const start = (offset ?? 1) - 1
    const end = start + (limit ?? DEFAULT_LIMIT)
    const page = lines.slice(start, end)
    if (page.length === 0) {
      return `Error: offset ${offset} is past the end of ${file_path}, which has ${lines.length} lines.`
    }

    const body = page.map((line, i) => `${String(start + i + 1).padStart(6)}\t${line}`).join('\n')
    const rest = lines.length - end
    return truncate(rest > 0 ? `${body}\n... ${rest} more lines` : body)
  },
}
```

*TypeScript here: [Zod modifiers and what `z.infer` makes of them](./ts/phase-2a.md#ts-5) ·
[`.catch(() => null)` as a narrowing device](./ts/phase-2a.md#ts-6).*

- `readFiles` stores the resolved absolute path, so `./src/a.ts` and `src/a.ts` count as one file.
- Three errors, each naming the tool to try next.

### 5. src/tools/write.ts

**Why.** `echo "..." > file` mangles quotes and `$`. Part b's fizzbuzz test starts with a Write.

```ts
import { z } from 'zod'
import { mkdir, stat } from 'node:fs/promises'
import { dirname, relative } from 'node:path'
import type { Tool } from './types'
import { resolveInside } from './guards'

const params = z.object({
  file_path: z
    .string()
    .describe('Path to write, relative to the project directory or absolute. Missing parent directories are created.'),
  content: z.string().describe('The complete contents of the file. This replaces the file entirely.'),
})

export const write: Tool<z.infer<typeof params>> = {
  name: 'Write',
  description:
    'Write a whole file, creating it and any missing parent directories, or replacing it if it ' +
    'already exists. The content you give becomes the entire file, so to change part of an ' +
    'existing file use Edit instead. Prefer Edit for any file you did not create yourself.',
  params,
  renderLine: ({ file_path, content }) => `Write(${file_path}, ${content.length} bytes)`,

  async execute({ file_path, content }, ctx) {
    const path = resolveInside(ctx.cwd, file_path)
    const existed = (await stat(path).catch(() => null)) !== null

    await mkdir(dirname(path), { recursive: true })
    const bytes = await Bun.write(path, content)
    ctx.readFiles.add(path)

    const shown = relative(ctx.cwd, path)
    const lines = content === '' ? 0 : content.split('\n').length
    return `${existed ? 'Replaced' : 'Created'} ${shown}, ${bytes} bytes, ${lines} lines`
  },
}
```

- `Replaced` vs `Created` tells the model if it just overwrote someone's file.
- Writing counts as reading, so Write then Edit on the same file works.

### 6. src/tools/edit.ts, with a bad description on purpose

**Why.** Changing existing code is most of what a coding agent does. Type the vague description as
written; step 7 fixes it.

```ts
import { z } from 'zod'
import { relative } from 'node:path'
import type { Tool } from './types'
import { resolveInside } from './guards'

const params = z.object({
  file_path: z.string(),
  old_string: z.string().min(1),
  new_string: z.string(),
  replace_all: z.boolean().optional(),
})

/** The changed region with line numbers, so the model can see what it did. */
function preview(text: string, at: number, inserted: string): string {
  const lines = text.split('\n')
  const changed = text.slice(0, at).split('\n').length
  const from = Math.max(0, changed - 3)
  const to = Math.min(lines.length, changed + inserted.split('\n').length + 2)
  return lines
    .slice(from, to)
    .map((line, i) => `${String(from + i + 1).padStart(6)}\t${line}`)
    .join('\n')
}

export const edit: Tool<z.infer<typeof params>> = {
  name: 'Edit',
  description: 'Edit a file.',
  params,
  renderLine: ({ file_path }) => `Edit(${file_path})`,

  async execute({ file_path, old_string, new_string, replace_all }, ctx) {
    const path = resolveInside(ctx.cwd, file_path)
    const shown = relative(ctx.cwd, path)

    if (!ctx.readFiles.has(path)) {
      return `Error: you have not read ${shown} in this conversation. Call Read on it first, then Edit it.`
    }
    if (old_string === new_string) {
      return `Error: old_string and new_string are identical, so this edit would change nothing.`
    }

    const text = await Bun.file(path).text()
    const count = text.split(old_string).length - 1

    if (count === 0) {
      return (
        `Error: old_string was not found in ${shown}. It must match the file exactly, including ` +
        `indentation and without line numbers. Read ${shown} again and copy the text from it.`
      )
    }
    if (count > 1 && !replace_all) {
      return (
        `Error: old_string appears ${count} times in ${shown}. Add more surrounding lines to make ` +
        `it unique, or pass replace_all: true to change all ${count}.`
      )
    }

    const at = text.indexOf(old_string)
    const updated = replace_all
      ? text.split(old_string).join(new_string)
      : text.slice(0, at) + new_string + text.slice(at + old_string.length)

    await Bun.write(path, updated)
    return `Edited ${shown}, ${count} replacement${count === 1 ? '' : 's'}.\n${preview(updated, at, new_string)}`
  },
}
```

*TypeScript here: [Zod modifiers and what `z.infer` makes of them](./ts/phase-2a.md#ts-5) ·
[why `preview` sits outside the object](./ts/phase-2a.md#ts-2).*

- Every check runs before anything is written.
- No `String.replace`: it only replaces the first match, and `$&` in the new text is a special token.
- The preview lets the model spot a wrong indent immediately.

`bun run typecheck` should be green now.

### 7. Watch the description fail, then fix it

**Why.** The point of the phase: same model, same task, different behavior from one paragraph.

```sh
cat > notes.txt <<'EOF'
TODO write the tests
TODO check the mtime sort
ship it
EOF
bun run bin/shrek.ts -p "in notes.txt, change the first TODO to DONE and leave the others alone"
```

Expect fumbling: an Edit before a Read, a bare `"TODO"` refused with a count, line numbers pasted
into `old_string`, or `replace_all: true`. Each is a fair reading of `Edit a file.`

Now fix the description and add `.describe()` to all four parameters:

```ts
const params = z.object({
  file_path: z.string().describe('Path to the file to change. Read it first.'),
  old_string: z
    .string()
    .min(1)
    .describe(
      'The exact text to replace, copied from a Read of this file. It must match byte for byte, ' +
        'including indentation, and must never include the line numbers Read prints.',
    ),
  new_string: z.string().describe('The text to put in its place. Pass an empty string to delete.'),
  replace_all: z
    .boolean()
    .optional()
    .describe('Replace every occurrence. Without it, old_string must appear exactly once.'),
})
```

```ts
  description:
    'Replace an exact piece of text in a file with different text. ' +
    'old_string must appear exactly once in the file, so include enough surrounding lines to make ' +
    'it unique; to change every occurrence instead, pass replace_all: true. ' +
    'You must Read a file before you Edit it. ' +
    'Prefer this over Write for any file that already exists.',
```

Restore `notes.txt` with the same `cat` command, rerun the prompt, then compare the two runs:

```sh
D=~/.shrek/projects/$(printf '%s' "$PWD" | tr -cs 'A-Za-z0-9' '-')
GOOD=$(ls -t "$D"/*.jsonl | sed -n 1p)
VAGUE=$(ls -t "$D"/*.jsonl | sed -n 2p)

calls() { jq -r 'select(.message.tool_calls) | .message.tool_calls[] | .function.name + " " + .function.arguments' "$1"; }
diff -y --width=160 <(calls "$VAGUE") <(calls "$GOOD")
```

The left column is longer. Every extra line is a wasted request you paid for.

### 8. Commit

```sh
rm notes.txt
bun run typecheck
git add -A
git diff --cached | grep -iE 'sk-or-|api[_-]?key'
git commit -m "phase 2a: tool registry and the file tools"
```

---

## Test

Make a fixture. Bun reads `.env` only from the current folder, so put your key in
`~/.shrek/config.json` as `{ "apiKey": "sk-or-v1-..." }` first.

```sh
mkdir -p /tmp/shrek-fixture/src
printf 'const x = 1\nconst y = 1\n' > /tmp/shrek-fixture/src/a.ts
cd /tmp/shrek-fixture
bun run /Users/youruser/repo/your-agent/bin/shrek.ts -p "in src/a.ts change const to let on the first line only"
cat src/a.ts
```

```
let x = 1
const y = 1
```

You may see the "appears 2 times" error on the way; the model recovers from it. That's fine.

- Both lines changed: the single-match path is using `split().join()`.
- Nothing changed: an error is being thrown instead of returned.
- `$ cat src/a.ts` instead of `Read(...)`: one of step 3's prompt edits didn't land.

### Deliberate failure: let a tool throw

Comment out the `try`/`catch` in `dispatch`, keeping the inner `return`. From your project folder:

```sh
bun run bin/shrek.ts -p "read ../../etc/passwd"; echo "exit $?"
D=~/.shrek/projects/$(printf '%s' "$PWD" | tr -cs 'A-Za-z0-9' '-')
F=$(ls -t "$D"/*.jsonl | head -1)
jq -r 'select(.message.tool_calls) | .message.tool_calls[].id' "$F"
jq -r 'select(.message.role == "tool") | .message.tool_call_id' "$F"
```

The run dies with `exit 1`, the first `jq` prints an id and the second prints nothing: a saved
transcript with an unanswered call, which can never be resumed. Put the `try` back and rerun: the
model says it can't read outside the project, `exit 0`, both lists match.

---

## Gotchas

- **`String.replace` is a trap.** One match only, and `$&` in the replacement is a token.
- **`.describe()` strings reach the model.** They're interface, not comments.
- **Tab, not spaces, after Read's line numbers.** It shows the model where the number ends.
- **macOS `/tmp` is really `/private/tmp`.** Compare resolved paths, or use `mkdtemp`.

---

## Recap

`guards.ts` keeps paths inside the project and caps output. `registry.ts` builds schemas once,
renders the display line, and dispatches each call through validation and one `try`, never
throwing. Read, Write and Edit are one file each; nothing else changed to add them.

1. `dispatch` never throws but `resolveInside` always does. Why is that split right?
2. Edit refuses when `old_string` appears twice. What goes wrong if it edits the first match instead?

Next, part b adds Glob and Grep, runs calls in parallel, and puts the tools under `bun test`.
