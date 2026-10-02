# Phase 1a: agent loop

About an hour. Six small files.

Phase 1 is two sittings. Part a builds the loop and gets an answer out of it. Part b saves every
run to disk.

---

## The big picture

After Phase 0 shrek prints its settings and exits. It has never talked to a model.

After 1a:

```sh
shrek -p "how many .ts files are in this repo?"
```

shrek sends your question to a model. The model asks shrek to run
`find . -name '*.ts' | wc -l`. shrek runs it, sends the output back, and the model answers `7`.

That loop **is** the product. Every later phase wraps it: more tools (2), a UI (3), permission
prompts (4), hooks (5), streaming (6), sub-agents (9). The loop itself barely changes again.

Gaps on purpose: no file tools yet (Phase 2), no UI (3), no permission prompt (4), and it forgets
everything on exit (part b).

## Files

| File | Job |
|---|---|
| `src/tools/types.ts` | the shape every tool must have |
| `src/tools/bash.ts` | the one tool: run a shell command, return its output as text |
| `src/agent/events.ts` | the things the loop announces while it runs (like Redux action types) |
| `src/agent/systemPrompt.ts` | standing instructions the model gets every run |
| `src/agent/loop.ts` | call the model, run the tools it asked for, repeat |
| `bin/shrek.ts` | replaced: adds the `-p` flag |

TypeScript help for this phase: [`learn/ts/phase-1a.md`](./ts/phase-1a.md).

---

## Remember this

> The model has no memory. Each request sends the **whole conversation** as one array of messages,
> and the loop's only job is appending the right things to it, in the right order. When the model
> asks for a tool, the next thing in the array must be exactly one `tool` reply per call. Miss one
> and the API rejects the array forever. So a tool never throws: even a failure is just text sent
> back.
>
> **The array is the conversation. Every call gets one answer.**

---

## Why

**The message array is the whole state.** A chat window looks like it remembers because it resends
everything each time. So shrek keeps one array and grows it. A **token** is about three quarters of
a word and is what you pay for; since the whole array is resent each round, long runs get expensive
(Phase 7 counts it, Phase 11 shrinks it).

**A tool is an object, not a function.** Each tool has a `name`, a `description` the model reads, a
Zod `params` schema, and `execute`. The schema is both the check on what the model sends and the
description of the arguments sent to the model, so the two can't drift. In Phase 2 adding five
tools changes zero lines of the loop.

**The loop yields instead of printing.** `runAgent` hands back events one at a time and never
prints. Today `bin/shrek.ts` prints them as lines. Phase 3 renders the same events in React. Phase
9 collects them silently. One loop, three consumers.

**A tool failure is data.** "command not found, exit code 127" is a useful answer; the model reads
it and tries something else. Only problems outside the tool (network down) are real exceptions.

---

## Worked example

The question is "how many .ts files are in this repo?". Predict before opening each one.

### Round 1: one full exchange

The array starts as a system message and your question. The model replies asking to run a command.
You run it and it prints `7`. Then the model answers. What is in the array at the end?

<details><summary>Predict, then open</summary>

Five messages:

```ts
[
  { role: 'system', content: 'You are shrek, a coding agent running at /Users/youruser/repo ...' },
  { role: 'user', content: 'how many .ts files are in this repo?' },
  {
    role: 'assistant',
    content: null,
    tool_calls: [
      {
        id: 'call_9Kq2xR',
        type: 'function',
        function: { name: 'Bash', arguments: '{"command":"find . -name \'*.ts\' | wc -l"}' },
      },
    ],
  },
  { role: 'tool', tool_call_id: 'call_9Kq2xR', content: '7' },
  { role: 'assistant', content: 'There are 7 TypeScript files in this repo.' },
]
```

Three things to notice:

- `content: null` on the third. The model said nothing, it only asked.
- `arguments` is a **string** of JSON. You parse it, and it may not parse.
- `tool_call_id` copies the call's `id`. That id is the only link between question and answer.

The loop stops when a reply has no `tool_calls`. That is the entire exit condition.
</details>

### Round 2: two commands at once

```ts
tool_calls: [
  { id: 'call_A1', function: { name: 'Bash', arguments: '{"command":"git branch --show-current"}' } },
  { id: 'call_B2', function: { name: 'Bash', arguments: '{"command":"git status --short"}' } },
]
```

The first prints `main`. The second prints nothing. What do you append?

<details><summary>Predict, then open</summary>

Two `tool` messages, one per call, in order:

```ts
{ role: 'tool', tool_call_id: 'call_A1', content: 'main' },
{ role: 'tool', tool_call_id: 'call_B2', content: '(no output)' },
```

Skip the second because it printed nothing, and the API answers:

```
400 An assistant message with 'tool_calls' must be followed by tool messages
responding to each 'tool_call_id'. The following tool_call_ids did not have
response messages: call_B2
```

Empty output still means something (here: the git tree is clean), so send `(no output)`.
</details>

### Round 3: the command fails

The model runs `tsc --noEmit` and gets `sh: tsc: command not found`, **exit code** 127 (the number
a program leaves behind: 0 means success). What if `execute` throws instead of returning?

<details><summary>Predict, then open</summary>

Correct: an ordinary tool message.

```ts
{ role: 'tool', tool_call_id: 'call_C3', content: 'sh: tsc: command not found\n(exit code 127)' }
```

Next round the model tries `bunx tsc --noEmit`. That self-correction is the most useful thing an
agent does, and you get it by passing the error through.

If `execute` throws, the process dies with `call_C3` unanswered. After part b saves that array to
disk, it can never be resumed. Same rule for arguments that won't parse: catch it, send
`Error: arguments were not valid JSON`, move on.
</details>

---

## Your task

Seven steps. In a second terminal, run `bunx tsc --noEmit --watch` and leave it running. It
re-checks on every save and prints `Found 0 errors`.

### 1. src/tools/types.ts

**Why.** The contract every tool signs. Phase 2 adds five more tools and `loop.ts` doesn't change.

```ts
import { z } from 'zod'
import type { ChatCompletionFunctionTool } from 'openai/resources/chat/completions'

/** What a tool is allowed to know about the run it is part of. */
export type ToolContext = {
  cwd: string
  /** Aborted when the user hits ctrl-c. Long tools must respect it. */
  signal: AbortSignal
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

/** The tool as OpenRouter wants it, built from the Zod schema so the two cannot drift. */
export function toOpenAITool(tool: AnyTool): ChatCompletionFunctionTool {
  const parameters = z.toJSONSchema(tool.params) as Record<string, unknown>
  delete parameters.$schema
  return {
    type: 'function',
    function: { name: tool.name, description: tool.description, parameters },
  }
}
```

*TypeScript here: [generics and `Tool<T>`](./ts/phase-1a.md#ts-1) ·
[`any` and `AnyTool`](./ts/phase-1a.md#ts-4) · [functions inside types](./ts/phase-1a.md#ts-5) ·
[library types](./ts/phase-1a.md#ts-11).*

- `execute` returns `Promise<string>`, never an error type. Failure is a string too.
- `delete parameters.$schema`: some providers reject the extra key with a confusing 400.

### 2. src/tools/bash.ts

**Why.** The only thing shrek can actually do today.

```ts
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
    'Use this to inspect the project, run builds and tests, and read or change files. ' +
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
```

*TypeScript here: [`typeof` in a type position](./ts/phase-1a.md#ts-2) ·
[`z.infer<typeof params>`](./ts/phase-1a.md#ts-3).*

- **stdout** is where a program prints its answer, **stderr** where it prints complaints. The model
  wants both, so they are merged.
- The "truncated" marker tells the model the output is partial, so it doesn't reason about text it
  never saw.
- The blocklist is weak on purpose. Phase 4 replaces it. Until then, run shrek somewhere safe.

### 3. src/agent/events.ts

**Why.** The vocabulary the loop speaks. Printed today, rendered in Phase 3, bus events in Phase 5.

```ts
/** Why a turn ended. The first three are the real engine's names. */
export type TurnCompleteReason = 'answer' | 'aborted' | 'error' | 'max_steps'

/** Everything the loop announces. `turnId` is on all of them, minted once at the start. */
export type AgentEvent =
  | { type: 'turn.start'; turnId: string; text: string }
  | { type: 'turn.step'; turnId: string; step: number; kind: 'text'; text: string }
  | { type: 'turn.step'; turnId: string; step: number; kind: 'tool'; id: string; name: string; line: string }
  | { type: 'turn.step'; turnId: string; step: number; kind: 'result'; id: string; output: string }
  | { type: 'turn.abort'; turnId: string }
  | {
      type: 'turn.complete'
      turnId: string
      answer: string
      durationMs: number
      isAborted: boolean
      reason: TurnCompleteReason
    }
```

*TypeScript here: [discriminated unions](./ts/phase-1a.md#ts-7).*

- Same pattern as Redux actions: check `event.type` and TypeScript knows which fields exist.
- `turn.complete` fires on every ending, with a `reason`, so the caller can tell an answer from a
  crash.

### 4. src/agent/systemPrompt.ts

**Why.** Without it the model doesn't know where it is, what day it is, or that it should act
rather than explain.

```ts
/** The standing instructions, rebuilt each run because `cwd` and the date change. */
export function systemPrompt(cwd: string): string {
  return [
    `You are shrek, a coding agent running in a terminal at ${cwd} on ${process.platform}.`,
    `Today is ${new Date().toISOString().slice(0, 10)}.`,
    '',
    'Use the Bash tool to find things out. Never guess about the contents of this machine',
    'and never describe a command you could simply run.',
    '',
    'When you have the answer, give it in one or two short lines with no preamble.',
  ].join('\n')
}
```

- A function, not a constant, because `cwd` is only known at startup. Phases 10 and 12 append to it.

### 5. src/agent/loop.ts

**Why.** This is the phase. Everything above is plumbing for these sixty lines.

Before typing, run [TS-8](./ts/phase-1a.md#ts-8): a ten-line demo of a function that pauses at
`yield` and resumes when asked. That is what `async function*` means.

```ts
import type OpenAI from 'openai'
import type {
  ChatCompletionMessageParam,
  ChatCompletionMessageToolCall,
} from 'openai/resources/chat/completions'
import type { AnyTool } from '../tools/types'
import { toOpenAITool } from '../tools/types'
import type { AgentEvent, TurnCompleteReason } from './events'
import { systemPrompt } from './systemPrompt'

export type RunOptions = {
  client: OpenAI
  model: string
  tools: AnyTool[]
  prompt: string
  cwd?: string
  /** The cap. Twenty rounds is more than any sane task needs. */
  maxSteps?: number
  signal?: AbortSignal
}

/** Validated and ready, or the exact string the model gets back instead. */
type Prepared = { tool: AnyTool; args: unknown } | { error: string }

function prepare(tools: Map<string, AnyTool>, call: ChatCompletionMessageToolCall): Prepared {
  if (call.type !== 'function') return { error: `Error: unsupported tool call type ${call.type}` }

  const tool = tools.get(call.function.name)
  if (!tool) {
    const known = [...tools.keys()].join(', ')
    return { error: `Error: no tool named ${call.function.name}. Available: ${known}` }
  }

  let raw: unknown
  try {
    raw = JSON.parse(call.function.arguments || '{}')
  } catch {
    const sent = JSON.stringify(call.function.arguments)
    return { error: `Error: arguments were not valid JSON: ${sent}` }
  }

  const parsed = tool.params.safeParse(raw)
  if (!parsed.success) {
    return { error: `Error: invalid arguments for ${tool.name}: ${parsed.error.message}` }
  }

  return { tool, args: parsed.data }
}

export async function* runAgent(opts: RunOptions): AsyncGenerator<AgentEvent, void, void> {
  const cwd = opts.cwd ?? process.cwd()
  const maxSteps = opts.maxSteps ?? 20
  const signal = opts.signal ?? new AbortController().signal
  const turnId = crypto.randomUUID()
  const startedAt = Date.now()

  const byName = new Map(opts.tools.map((tool) => [tool.name, tool]))
  const schemas = opts.tools.map(toOpenAITool)

  const messages: ChatCompletionMessageParam[] = [
    { role: 'system', content: systemPrompt(cwd) },
    { role: 'user', content: opts.prompt },
  ]
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

      const response = await opts.client.chat.completions.create(
        { model: opts.model, messages, tools: schemas, max_tokens: 8000 },
        { signal },
      )

      const message = response.choices[0]?.message
      if (!message) throw new Error('the model returned no choices')
      messages.push(message)

      if (message.content) {
        answer = message.content
        yield { type: 'turn.step', turnId, step, kind: 'text', text: message.content }
      }

      const calls = message.tool_calls ?? []
      if (calls.length === 0) break

      for (const call of calls) {
        const ready = prepare(byName, call)
        const name = call.type === 'function' ? call.function.name : call.type
        const line = 'error' in ready ? `${name}(?)` : ready.tool.renderLine(ready.args)
        yield { type: 'turn.step', turnId, step, kind: 'tool', id: call.id, name, line }

        let output: string
        if ('error' in ready) {
          output = ready.error
        } else {
          try {
            output = await ready.tool.execute(ready.args, { cwd, signal })
          } catch (error) {
            output = `Error: ${error instanceof Error ? error.message : String(error)}`
          }
        }

        messages.push({ role: 'tool', tool_call_id: call.id, content: output })
        yield { type: 'turn.step', turnId, step, kind: 'result', id: call.id, output }
      }

      if (step === maxSteps) reason = 'max_steps'
    }
  } catch (error) {
    reason = signal.aborted ? 'aborted' : 'error'
    answer = error instanceof Error ? error.message : String(error)
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

*TypeScript here: [a union of results and `in`](./ts/phase-1a.md#ts-6) ·
[`AsyncGenerator<Y, R, N>`](./ts/phase-1a.md#ts-8) · [`Map<K, V>`](./ts/phase-1a.md#ts-9) ·
[`let output: string`](./ts/phase-1a.md#ts-10).*

- `messages.push(message)` happens first, before anything can go wrong.
- `prepare` always returns a value and `execute` is wrapped in `try`, so the `tool` push can't be
  skipped. That is "Remember this" in code.
- `maxSteps` stops a model that keeps calling tools forever. On a paid model that's a bill.

### 6. bin/shrek.ts

**Why.** The loop needs a way in. `-p` runs shrek headless, which is how every test from here on
works. Paste the whole file over Phase 0's.

```ts
#!/usr/bin/env bun
import pkg from '../package.json'
import { loadConfig, type Config } from '../src/config'
import { createClient, keyStatus } from '../src/llm/client'
import { lookupModel } from '../src/llm/models'
import { ensureStateDir, stateDir } from '../src/paths'
import { runAgent } from '../src/agent/loop'
import { bash } from '../src/tools/bash'

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

  for await (const event of runAgent({
    client,
    model: config.model,
    tools: [bash],
    prompt,
    signal: controller.signal,
  })) {
    if (event.type === 'turn.step' && event.kind === 'tool') console.error(event.line)

    if (event.type === 'turn.complete') {
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

*TypeScript here: [narrowing on `type` then `kind`](./ts/phase-1a.md#ts-7).*

- Tool lines go to stderr, the answer to stdout, so `shrek -p ... > answer.txt` saves only the answer.
- `SIGINT` is ctrl-c. Catching it aborts the running command instead of leaving it orphaned.

### 7. Commit

```sh
bun run typecheck
git add -A
git diff --cached | grep -iE 'sk-or-|api[_-]?key'
git commit -m "phase 1a: agent loop"
```

The grep should match only `.env.example`.

---

## Test

```sh
bun run bin/shrek.ts -p "how many .ts files are in this repo?"
```

```
$ find . -name '*.ts' -not -path './node_modules/*' | wc -l
There are 7 TypeScript files in this repo.
```

Command and wording vary. What must be true: at least one `$ ` line, the right number, and
`echo $?` prints `0`.

Watch a yield arrive:

```sh
bun run bin/shrek.ts -p "run the command 'sleep 5 && echo hello' and tell me exactly what it printed"
```

The `$ sleep 5 ...` line appears at once, then five seconds later the answer. If both appear
together at the end, something is collecting events instead of yielding them.

### Deliberate failure: a command that fails

```sh
bun run bin/shrek.ts -p "run the command 'definitelynotacommand --help' and tell me exactly what happened"
```

shrek doesn't crash; the answer mentions "not found" and exit code 127.

- A stack trace means something threw instead of returning a string. Check the `try` around `execute`.
- An invented answer means the `tool` message never got pushed.

---

## Gotchas

- **Free models sometimes narrate instead of calling.** "I'll run ls for you." with no
  `tool_calls`, so the loop stops. That's the model, not your loop. Try another free model.
- **A `:free` model rate-limits fast.** A 429 ends the turn with `reason: 'error'`. Wait, or switch
  with `SHREK_MODEL=...`.
- **`response.choices` can be empty.** The `if (!message) throw` line turns that into a clean
  `error` ending.
- **No key** prints `shrek: no OpenRouter key...` from Phase 0's `createClient`.

---

## Recap

`types.ts` and `bash.ts` define a tool and the first one. `loop.ts` sends the array, pushes the
reply, runs each call, pushes one `tool` message per call, and repeats until there are no calls.
`bin/shrek.ts` prints the events: commands on stderr, answer on stdout.

1. The model asks for two commands and the first one's arguments won't parse. How many messages are
   appended before the next request, and what is in each?
2. A tool that throws and a network error are handled differently. Which becomes a `tool` message
   and which ends the turn?

Next, part b saves every message to a file under `~/.shrek/projects/` and the raw traffic to
`~/.shrek/logs/shrek.log`.
