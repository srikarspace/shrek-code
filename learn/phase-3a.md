# Phase 3a: a chat you can hold

About an hour. Four new files, two replaced.

---

## The big picture

After Phase 2 shrek is one prompt per run. You type `shrek -p "..."`, it prints tool lines and an
answer as plain text, and the process ends. A follow-up question starts from nothing.

After 3a:

```sh
bun run dev
```

opens a window inside the terminal. You type a question, watch `⏺ Read(package.json)` appear with a
dimmed `⎿ 48 lines` under it, read the answer, and ask "what version does that same file say?". shrek
knows which file you mean, because the second turn carries the first.

What later phases build on this: Phase 4 draws its "allow this?" prompt into this UI. Phase 6
streams the answer into it word by word. Phase 8 puts a todo list on screen. All three add a
component and an event; none of them touch the loop's drawing code, because there isn't any.

3b adds a real input box with history and multi-line paste, a status bar, and Ctrl+C
that stops a turn instead of killing the app.

## Files

| File | Job |
|---|---|
| `src/ui/theme.ts` | new: every color and symbol in one place |
| `src/ui/ToolLine.tsx` | new: `⏺ Read(src/config.ts)` plus a dimmed `⎿ 42 lines` |
| `src/ui/Transcript.tsx` | new: the list of things on screen, finished turns printed once |
| `src/ui/App.tsx` | new: turns events into screen state, plus a temporary input |
| `src/agent/loop.ts` | replaced: takes the earlier turns as `history` |
| `bin/shrek.ts` | replaced: no `-p` means open the UI; the bridge between loop and UI |

TypeScript help for this phase: [`learn/ts/phase-3a.md`](./ts/phase-3a.md).

---

## Remember this

> The loop does not draw. It yields events: a turn started, a tool was called, a result came back,
> the turn ended. React does not run the agent. It folds those events into state and renders it.
> One small function in `bin/shrek.ts` hands the events from one to the other, and it is the only
> file that imports both.
>
> **The loop yields events and React renders them; neither imports the other.**

---

## Why

**A terminal UI is a redraw, not a log.** Plain `console.log` only ever adds lines at the bottom. To
show `⎿ running` and later replace it with `⎿ 48 lines`, something has to move the cursor back up and
draw again. Ink does that, and lets you describe the screen as React components while it does.

**The loop already speaks in events.** Since Phase 1a `runAgent` yields `turn.start`, `turn.step` and
`turn.complete`. `-p` mode prints some of them. The UI is a second consumer of the same stream.
Nothing about the loop's job changes.

**Two screens, one loop.** `-p` stays plain text for scripts and pipes. The TUI (text user interface,
an app drawn with characters inside the terminal) is for you. If the loop knew about either, the
other would have to work around it.

**A conversation is a growing array.** The model remembers nothing between requests. "That same
file" only works if turn two sends turn one's messages again. So the loop takes `history`, and the
bridge keeps it.

---

## Worked example

Make a file `hello.tsx` in your project root (you will delete it at the end):

```tsx
import { useEffect, useState } from 'react'
import { render, Box, Text } from 'ink'

function Counter() {
  const [n, setN] = useState(0)
  useEffect(() => {
    const timer = setInterval(() => setN((x) => x + 1), 100)
    return () => clearInterval(timer)
  }, [])
  return <Box flexDirection="column"><Text>header</Text><Text color="green">{n} ticks</Text></Box>
}

render(<Counter />)
```

### Round 1: what is on screen after two seconds?

```sh
bun hello.tsx
```

<details><summary>Predict, then open</summary>

Two lines, `header` and `20 ticks`, with the number changing in place. Not twenty lines.

It is the same component you would write for the browser, with `<Box>` for `<div>` and `<Text>` for
`<span>`. On every state change Ink renders the tree to text, moves the cursor up as many lines as it
drew last time, clears them, and draws the new frame. React in the browser patches the DOM; Ink
patches the bottom of your terminal.

Ctrl+C to stop it.
</details>

### Round 2: the loop prints while Ink draws

Your loop already does this. `src/log.ts` writes a JSON line to stderr when `--debug` is on, from
inside `runAgent`, while a turn runs. Simulate it: add these two lines to the bottom of `hello.tsx`
and run it again.

```tsx
setTimeout(() => process.stderr.write('{"tag":"request"}\n'), 150)
setTimeout(() => process.stderr.write('{"tag":"response"}\n'), 350)
```

<details><summary>Predict, then open</summary>

Neither JSON line stays on screen. Above the counter there are now **two extra `header` lines**
that never go away.

Ink thinks its frame is the last two lines. The stray write pushed the frame up one line. On the
next redraw Ink goes up two lines and clears them. Those are the JSON line and the old `1 ticks`. The
old `header` is out of reach, so it stays as a ghost, and the new frame is drawn below it. Every
stray write leaves one more ghost. In shrek, with a ten-line frame and a debug line per request,
the screen fills with torn copies of the transcript.

So in the TUI the loop must not write to the terminal at all, not even for logging. That is why
the new `bin/shrek.ts` only turns stderr debugging on for `-p`. In the TUI, debug lines still go to
`~/.shrek/logs/shrek.log`.
</details>

### Round 3: then let the loop update React directly?

Suppose `runAgent` took `setItems` as an option and called it on each step. No printing, no ghosts.
What breaks?

<details><summary>Predict, then open</summary>

The screen works. These break:

- `-p` mode has no React and no `setItems`. It needs its own path through the loop, or a fake.
- `tests/` and Phase 9's sub-agents (a loop with no screen at all) now have to bring a UI along.
- Phase 4's approval prompt, Phase 6's streaming text and Phase 8's todo list would each add a
  call inside the loop. The loop becomes a drawing function.

With events, the loop says what happened and stops there. Each screen decides what that looks
like. A new screen is a new consumer; a new kind of thing on screen is a new event plus a
component. The loop file only changes when the agent's behaviour does.
</details>

Delete `hello.tsx`.

---

## Your task

Six steps. Keep `bunx tsc --noEmit --watch` running in a second terminal. Ink, React and
`ink-text-input` are already in `package.json` from Phase 0, and `tsconfig.json` already has
`"jsx": "react-jsx"`, so there is nothing to install.

### 1. src/ui/theme.ts

**Why.** Colors scattered across six components drift. One file means Phase 4's red "deny" and
your tool green are picked in the same place. Make the `src/ui/` folder first.

```ts
/** Every color and symbol the UI draws with. Change the look here, nowhere else. */
export const theme = {
  user: 'cyan',
  tool: 'green',
  error: 'red',
  dim: 'gray',
} as const

export const glyph = {
  prompt: '>',
  tool: '⏺',
  result: '⎿',
} as const
```

*TypeScript here: [`as const` on an object of colors](./ts/phase-3a.md#ts-1).*

- Ink accepts color names like `'cyan'` and `'gray'`, so these are plain strings.

### 2. src/ui/ToolLine.tsx

**Why.** A tool call is the most common thing on screen and the one you scan to see what it
touched and whether it worked. One line for the call, one dim line for the result.

```tsx
import { Box, Text } from 'ink'
import { glyph, theme } from './theme'

type Props = { line: string; output?: string }

/** `⏺ Read(src/config.ts)`, then a dimmed `⎿ 42 lines` once the result is in. */
export function ToolLine({ line, output }: Props) {
  return (
    <Box flexDirection="column">
      <Text>
        <Text color={theme.tool}>{glyph.tool}</Text> {line}
      </Text>
      <Text color={output?.startsWith('Error') ? theme.error : theme.dim}>
        {'  '}
        {glyph.result} {output === undefined ? 'running' : summarize(output)}
      </Text>
    </Box>
  )
}

/** One short line about a result. The full text is in the transcript, not on screen. */
function summarize(output: string): string {
  const lines = output.split('\n')
  if (lines.length > 1 && !output.startsWith('Error')) return `${lines.length} lines`
  const first = lines[0] ?? ''
  return first.length > 80 ? `${first.slice(0, 80)}...` : first
}
```

*TypeScript here: [`.tsx` files and typed props](./ts/phase-3a.md#ts-2).*

- `output` is missing until the result event arrives, so the second line says `running` first.
- Errors from `dispatch` always start with `Error` (Phase 2a), so they turn red without a flag.
- The screen gets a summary. The full output is in the JSONL transcript if you need it.

### 3. src/ui/Transcript.tsx

**Why.** A long chat redrawn on every event would flicker and get slow. Finished turns never
change, so they are printed once and left alone.

```tsx
import { Box, Static, Text } from 'ink'
import { ToolLine } from './ToolLine'
import { glyph, theme } from './theme'

/** One thing on screen. `id` is the React key, so it must never repeat. */
export type Item =
  | { kind: 'user'; id: string; text: string }
  | { kind: 'text'; id: string; text: string }
  | { kind: 'tool'; id: string; line: string; output?: string }
  | { kind: 'error'; id: string; text: string }

function Row({ item }: { item: Item }) {
  switch (item.kind) {
    case 'user':
      return <Text color={theme.user}>{glyph.prompt} {item.text}</Text>
    case 'text':
      return <Text>{item.text}</Text>
    case 'tool':
      return <ToolLine line={item.line} output={item.output} />
    case 'error':
      return <Text color={theme.error}>{item.text}</Text>
  }
}

type Props = { done: Item[]; live: Item[] }

/** Finished turns print once and scroll away. Only the current turn redraws. */
export function Transcript({ done, live }: Props) {
  return (
    <>
      <Static items={done}>
        {(item) => (
          <Box key={item.id} marginTop={item.kind === 'user' ? 1 : 0}>
            <Row item={item} />
          </Box>
        )}
      </Static>
      <Box flexDirection="column">
        {live.map((item) => (
          <Box key={item.id} marginTop={item.kind === 'user' ? 1 : 0}>
            <Row item={item} />
          </Box>
        ))}
      </Box>
    </>
  )
}
```

*TypeScript here: [narrowing `Item` inside a component](./ts/phase-3a.md#ts-3).*

- `<Static>` writes each item once, above everything else, and never redraws it. It becomes normal
  terminal scrollback.
- So the current turn lives outside it. A tool line still waiting for its result must be redrawable.
- `id` is the React key. Tool lines use the model's call id, which is also how a result finds its line.

### 4. src/ui/App.tsx

**Why.** This is where events become a screen. `apply` is the whole translation, as one pure
function. It takes the current view and one event and returns the next view. It is a reducer, the same shape
you would hand to React's `useReducer`.

```tsx
import { useState } from 'react'
import { Box, Text } from 'ink'
import TextInput from 'ink-text-input'
import type { AgentEvent } from '../agent/events'
import { Transcript, type Item } from './Transcript'
import { glyph, theme } from './theme'

/** How the UI starts a turn. bin/shrek.ts builds it, so the UI never touches the loop. */
export type RunTurn = (prompt: string) => AsyncIterable<AgentEvent>

/** `done` is every finished turn. `live` is the turn running now. */
export type View = { done: Item[]; live: Item[] }

/** Fold one event into what is on screen. Pure: same view and event in, same view out. */
export function apply(view: View, event: AgentEvent): View {
  const { done, live } = view
  switch (event.type) {
    case 'turn.start':
      return { done, live: [{ kind: 'user', id: event.turnId, text: event.text }] }
    case 'turn.step':
      if (event.kind === 'text') {
        const id = `${event.turnId}:${event.step}`
        return { done, live: [...live, { kind: 'text', id, text: event.text }] }
      }
      if (event.kind === 'tool') {
        return { done, live: [...live, { kind: 'tool', id: event.id, line: event.line }] }
      }
      return {
        done,
        live: live.map((item) =>
          item.kind === 'tool' && item.id === event.id ? { ...item, output: event.output } : item,
        ),
      }
    case 'turn.abort':
      return view
    case 'turn.complete': {
      const end: Item[] =
        event.reason === 'answer'
          ? []
          : [{ kind: 'error', id: `${event.turnId}:end`, text: `turn ended: ${event.reason}` }]
      return { done: [...done, ...live, ...end], live: [] }
    }
  }
}

type Props = { run: RunTurn }

export function App({ run }: Props) {
  const [view, setView] = useState<View>({ done: [], live: [] })
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(text: string) {
    const prompt = text.trim()
    if (!prompt || busy) return
    setDraft('')
    setBusy(true)
    try {
      for await (const event of run(prompt)) setView((v) => apply(v, event))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Box flexDirection="column">
      <Transcript done={view.done} live={view.live} />
      {busy ? (
        <Text color={theme.dim}>working...</Text>
      ) : (
        <Box>
          <Text color={theme.user}>{glyph.prompt} </Text>
          <TextInput value={draft} onChange={setDraft} onSubmit={submit} />
        </Box>
      )}
    </Box>
  )
}
```

*TypeScript here: [`useState<View>`](./ts/phase-3a.md#ts-4) ·
[why `end` needs `: Item[]`](./ts/phase-3a.md#ts-5) ·
[a function type as a prop](./ts/phase-3a.md#ts-6).*

- `App` imports the `AgentEvent` **type** and nothing from `loop.ts`. It gets turns through `run`.
- A `result` event finds its tool line by id and fills in `output`. Parallel calls (Phase 2b) can
  finish in any order and each still lands on its own line.
- `turn.complete` moves `live` into `done`, which is the moment it gets printed by `<Static>`.
- `ink-text-input` is a stand-in. 3b replaces it with an input box of your own.

### 5. src/agent/loop.ts

**Why.** The second question needs the first one's messages. Two new lines: an option, and one
`push` before the new user message.

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
  /** Earlier turns of this conversation, without the system prompt. Empty for `-p`. */
  history?: ChatCompletionMessageParam[]
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
  messages.push(...(opts.history ?? []))
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

- History goes in with `messages.push`, not `add`. Those messages are already in the transcript
  from their own turn; `add` would write them a second time.
- The system prompt is not in `history`. It is rebuilt every turn, so the date stays right.
- `-p` passes no history and behaves exactly as before.

### 6. bin/shrek.ts

**Why.** Something has to know both sides. This file already wires config, client, registry and
transcript together, so the bridge goes here too.

```ts
#!/usr/bin/env bun
import { createElement } from 'react'
import { render } from 'ink'
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions'
import pkg from '../package.json'
import { loadConfig, type Config } from '../src/config'
import { createClient, keyStatus } from '../src/llm/client'
import { lookupModel } from '../src/llm/models'
import { ensureStateDir, stateDir } from '../src/paths'
import { runAgent } from '../src/agent/loop'
import type { AgentEvent } from '../src/agent/events'
import { enableDebug } from '../src/log'
import { openTranscript } from '../src/session/jsonl'
import { createRegistry } from '../src/tools/registry'
import { bash } from '../src/tools/bash'
import { read } from '../src/tools/read'
import { write } from '../src/tools/write'
import { edit } from '../src/tools/edit'
import { glob } from '../src/tools/glob'
import { grep } from '../src/tools/grep'
import { App } from '../src/ui/App'

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

/** The bridge. The only place that knows both the loop and the UI. */
async function runInteractive(config: Config): Promise<number> {
  const client = createClient(config)
  const transcript = await openTranscript()
  const history: ChatCompletionMessageParam[] = []

  async function* run(prompt: string): AsyncGenerator<AgentEvent> {
    for await (const event of runAgent({
      client,
      model: config.model,
      registry,
      prompt,
      history,
      onMessage: async (message, meta) => {
        if (message.role !== 'system') history.push(message)
        await transcript.write('message', { message, ...meta })
      },
    })) {
      if (event.type === 'turn.complete') {
        const { type, ...fields } = event
        await transcript.write(type, fields)
      }
      yield event
    }
  }

  const app = render(createElement(App, { run }))
  await app.waitUntilExit()
  return 0
}

async function main(argv: string[]): Promise<number> {
  const config = await loadConfig()
  await ensureStateDir()
  const flag = argv.findIndex((a) => a === '-p' || a === '--print')
  // Debug lines on stderr would tear Ink's frame, so the TUI logs to the file only.
  enableDebug(flag !== -1 && (config.debug || argv.includes('--debug')))

  if (argv.includes('--version') || argv.includes('-v')) {
    for (const line of versionLines(config)) console.log(line)
    return 0
  }

  if (flag !== -1) {
    const prompt = argv[flag + 1]
    if (!prompt) {
      console.error('usage: shrek -p "your question"')
      return 1
    }
    return runPrint(config, prompt)
  }

  return runInteractive(config)
}

const code = await main(process.argv.slice(2)).catch((error: unknown) => {
  console.error(`shrek: ${error instanceof Error ? error.message : String(error)}`)
  return 1
})

process.exit(code)
```

*TypeScript here: [`createElement` in a `.ts` file](./ts/phase-3a.md#ts-7).*

- `run` is an async generator that wraps `runAgent`. It adds `history` and the transcript, then
  passes every event through unchanged. `App` only sees the events.
- `onMessage` is how history grows. Every message the loop adds, except the system prompt, is
  pushed onto `history`, so the next turn sends it again.
- `waitUntilExit()` resolves when Ink unmounts, which for now is Ctrl+C. Then `process.exit(0)`.

### 7. Commit

```sh
bun test
bun run typecheck
git add -A
git diff --cached | grep -iE 'sk-or-|api[_-]?key'
git commit -m "phase 3a: ink tui and multi-turn history"
```

---

## Test

```sh
bun run dev
```

Type `read package.json and tell me only its name field`, Enter, and wait:

```
> read package.json and tell me only its name field
⏺ Read(package.json)
  ⎿ 48 lines
shrek-code
>
```

The `⎿` line says `running` first, then flips. Now ask `what version does that same file say? one
word`:

```
> what version does that same file say? one word
⏺ Read(package.json)
  ⎿ 48 lines
0.1.0
```

It knew which file. Ctrl+C exits back to your shell. `bun run dev -p "hi"` still prints plain text.

A free model sometimes takes a detour (writes a temp file, runs `sed`, deletes it). That is the
model, not your code, and it is exactly the kind of thing Phase 4 will make it ask about first.

### Deliberate failure: forget the history

In `bin/shrek.ts`, delete the `history,` line inside `runAgent({ ... })`. Run the same two questions.

The second answer is now a question back ("which file?") or a guess. Every turn starts from
`[system, user]` again; the UI still shows turn one, but the model never sees it. What you see and
what the model sees are separate things, and only `history` connects them. Put the line back.

- If it still answers `0.1.0`, the model guessed `package.json` from the word "version". Ask "and how
  many lines did it have?" instead.

---

## Gotchas

- **Nothing in `<Static>` ever updates.** Put a tool line in `done` before its result arrives and
  it says `running` forever. Only `turn.complete` moves things there.
- **Anything that writes to stdout or stderr tears the frame.** `console.log` is caught by Ink and
  printed above the frame, but `process.stdout.write`, `process.stderr.write` and child processes
  writing to your terminal are not.
- **A key must be unique across `done` and `live`.** Two items with one `id` and React reuses the
  wrong row. That is why text items use `turnId:step`, not the step alone.
- **Ctrl+C kills everything,** even mid-turn. That is Ink's default, and 3b replaces it.

---

## Recap

`bun run dev` opens a chat. Tool calls show as `⏺` lines whose `⎿` result fills in when it arrives.
Each turn sends the earlier ones as `history`, so follow-ups work. The loop is unchanged except for
that one option; `bin/shrek.ts` is the only file that sees both sides.

1. A tool result event arrives. How does `apply` know which line on screen it belongs to?
2. Why can the `--debug` stderr output stay on for `-p` but not for the TUI?
