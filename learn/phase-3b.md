# Phase 3b: input, status bar and Ctrl+C

About an hour. Two new files, two replaced.

---

## The big picture

After 3a you can hold a conversation, but the edges are rough. The input box is borrowed and
forgets everything you sent. Pasting a stack trace scrambles the screen. Nothing tells you which
model is answering or whether it is still working. And Ctrl+C mid-turn does not stop the turn. It
kills the whole app and your conversation with it.

After 3b:

```
╭──────────────────────────────────────────────────────────────╮
│ > why does this fail?                                        │
│   TypeError: Cannot read properties of undefined             │
│       at loadConfig (src/config.ts:14:22)                    │
╰──────────────────────────────────────────────────────────────╯
 nvidia/nemotron-3-super-120b-a12b:free in your-agent   ctrl+c to quit
```

Up and Down walk through what you sent before. A pasted block stays one message. Ctrl+C stops the
running turn and keeps the chat; Ctrl+C again with nothing running quits.

What later phases build on this: Phase 4's approval prompt takes over the keyboard the same way
`Input` does, with `isActive`. Phase 6 shows streaming progress in the status bar. Ctrl+C reaching
the loop as an abort is what lets every later long-running tool be stopped cleanly.

## Files

| File | Job |
|---|---|
| `src/ui/Input.tsx` | new: the prompt box, with history and multi-line paste |
| `src/ui/StatusBar.tsx` | new: model, folder, and what shrek is doing |
| `src/ui/App.tsx` | replaced: uses both, owns Ctrl+C, aborts the running turn |
| `bin/shrek.ts` | replaced: passes the abort signal through, tells Ink to leave Ctrl+C alone |

TypeScript help for this phase: [`learn/ts/phase-3b.md`](./ts/phase-3b.md).

---

## Remember this

> Ink puts the terminal in raw mode, so Ctrl+C is not a signal that kills the process. It is a key
> like any other, delivered to your components. That means the app decides what it means. shrek
> stops the turn if one is running and quits if not. The stop reaches the loop as an `AbortSignal`, the same one
> `-p` mode has used since Phase 1a.
>
> **In raw mode Ctrl+C is just a key, so the app decides what it means.**

---

## Why

**Raw mode.** Normally the terminal edits your line for you and only sends it on Enter, and Ctrl+C
makes it send the process a SIGINT (the "interrupt" signal that `-p` listens for). Raw mode turns
all of that off. Every key goes straight to the program, Ctrl+C included. Ink needs raw mode to see
arrow keys at all.

**Stop is not quit.** A model stuck reading every file in `node_modules` is the moment you reach for
Ctrl+C, and the moment you least want to lose the conversation. Stopping the turn is the common
case; quitting is the second press.

**A paste is not typing.** When you paste, the terminal sends the whole block at once, with a
carriage return (`\r`, the Enter key's character) between lines. A box that only knows about keys
cannot tell that apart from someone typing very fast.

**The screen should say what state it is in.** While a turn runs the input is switched off. Without
a status line you cannot tell "thinking" from "frozen".

---

## Worked example

### Round 1: Ctrl+C in the middle of a 3a turn

Back in 3a, you ask a question that takes a while, and press Ctrl+C while `⎿ running` is on screen.
`runPrint` has `process.on('SIGINT', () => controller.abort())`. What runs?

<details><summary>Predict, then open</summary>

Not that handler. In raw mode Ctrl+C never becomes a SIGINT; it arrives as the character `\x03`.
`runInteractive` never set up a handler anyway.

Ink sees the key and, by default, unmounts the app. `waitUntilExit()` resolves, `main` returns 0,
and `process.exit` ends the process with the model request still in flight. The turn never yields
`turn.complete`, so the transcript has no record of how it ended, and the conversation is gone.

The fix has three parts: tell Ink not to handle Ctrl+C (`exitOnCtrlC: false`), handle the key in
`App` with `useInput`, and give each turn an `AbortController` whose signal goes into `runAgent`. The
loop already knows what to do with an aborted signal.
</details>

### Round 2: paste three lines into a box where Enter submits

You write the obvious input box: `useInput`, and on `key.return` submit. You paste:

```
first line
second line
third line
```

<details><summary>Predict, then open</summary>

It does not submit early. Ink hands the whole paste to `useInput` as one string, and `key.return`
is only true when the input is exactly `\r`. So the box appends
`first line\rsecond line\rthird line`.

Then it draws that. A `\r` in the terminal means "go back to the start of this line", so
`second line` is written over `first line`, `third line` over that, and the box's right border is
overwritten too. You see one mangled line. Your `split('\n')` found no newlines, so the box thinks
it is one line.

The fix is `usePaste`. It turns on bracketed paste mode, where the terminal wraps every paste in
start and end markers. Ink routes anything between them to `usePaste` instead of `useInput`, and
the box swaps each `\r` for `\n` so it can draw real lines.
</details>

---

## Your task

Five steps. Keep `bunx tsc --noEmit --watch` running.

### 1. src/ui/Input.tsx

**Why.** You will send the same kind of question again and again ("run the tests", "now fix it").
Up arrow saves the retyping. And a stack trace pasted as one message is the most useful thing you
can give a coding agent.

```tsx
import { useState } from 'react'
import { Box, Text, useInput, usePaste } from 'ink'
import { glyph, theme } from './theme'

type Props = { onSubmit: (text: string) => void; isActive?: boolean }

/** The prompt box. Type, paste several lines, Up and Down through what you sent before. */
export function Input({ onSubmit, isActive = true }: Props) {
  const [value, setValue] = useState('')
  const [sent, setSent] = useState<string[]>([])
  // How far back in `sent` we are. 0 means the box shows what you are typing now.
  const [back, setBack] = useState(0)

  usePaste((text) => setValue((v) => v + text.replace(/\r\n?/g, '\n')), { isActive })

  useInput(
    (input, key) => {
      if (key.return) {
        const text = value.trim()
        if (!text) return
        onSubmit(text)
        setSent((s) => [...s, text])
        setBack(0)
        setValue('')
        return
      }
      if (key.upArrow || key.downArrow) {
        const next = Math.max(0, Math.min(sent.length, back + (key.upArrow ? 1 : -1)))
        setBack(next)
        setValue(next === 0 ? '' : (sent[sent.length - next] ?? ''))
        return
      }
      if (key.backspace || key.delete) {
        setValue((v) => v.slice(0, -1))
        return
      }
      if (key.ctrl || key.meta || key.escape || key.tab) return
      setValue((v) => v + input)
    },
    { isActive },
  )

  const lines = value.split('\n')
  return (
    <Box flexDirection="column" borderStyle="round" borderColor={isActive ? theme.user : theme.dim} paddingX={1}>
      {lines.map((line, i) => (
        <Text key={i}>
          <Text color={theme.user}>{i === 0 ? glyph.prompt : ' '} </Text>
          {line}
          {isActive && i === lines.length - 1 ? <Text inverse> </Text> : null}
        </Text>
      ))}
    </Box>
  )
}
```

*TypeScript here: [`useInput` and the `Key` object](./ts/phase-3b.md#ts-1) ·
[a default for an optional prop](./ts/phase-3b.md#ts-2).*

- `isActive` switches both hooks off while a turn runs, so keys you press then go nowhere instead
  of piling up in a box you cannot see.
- `back` counts from the newest message: 1 is the last one sent, 2 the one before. Down to 0 clears
  the box. Whatever you were typing before pressing Up is not kept; that is fine for now.
- The cursor is one inverted space. Editing happens only at the end; no left and right arrows yet.
- `key.ctrl` keys are ignored here so Ctrl+C does not type a `c`. `App` handles it.

### 2. src/ui/StatusBar.tsx

**Why.** One dim line answers "which model, which folder, is it working, how long did that take"
without you asking.

```tsx
import { basename } from 'node:path'
import { Box, Text } from 'ink'
import { theme } from './theme'

type Props = { model: string; cwd: string; busy: boolean; lastMs?: number }

/** One line under the input: where you are, what is answering, and what it is doing. */
export function StatusBar({ model, cwd, busy, lastMs }: Props) {
  const state = busy
    ? 'working, ctrl+c to stop'
    : lastMs === undefined
      ? 'ctrl+c to quit'
      : `last turn ${(lastMs / 1000).toFixed(1)}s, ctrl+c to quit`

  return (
    <Box justifyContent="space-between" paddingX={1}>
      <Text color={theme.dim}>
        {model} in {basename(cwd)}
      </Text>
      <Text color={busy ? theme.tool : theme.dim}>{state}</Text>
    </Box>
  )
}
```

- `basename` keeps it short: `your-agent`, not `/Users/youruser/repo/your-agent`.
- The right side always says what Ctrl+C will do next. So you never have to remember what it does.

### 3. src/ui/App.tsx

**Why.** `App` is the only component that knows whether a turn is running, so it is the one that
can decide what Ctrl+C means.

```tsx
import { useRef, useState } from 'react'
import { Box, useApp, useInput } from 'ink'
import type { AgentEvent } from '../agent/events'
import { Input } from './Input'
import { StatusBar } from './StatusBar'
import { Transcript, type Item } from './Transcript'

/** How the UI starts a turn. bin/shrek.ts builds it, so the UI never touches the loop. */
export type RunTurn = (prompt: string, signal: AbortSignal) => AsyncIterable<AgentEvent>

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

type Props = { run: RunTurn; model: string; cwd: string }

export function App({ run, model, cwd }: Props) {
  const { exit } = useApp()
  const [view, setView] = useState<View>({ done: [], live: [] })
  const [busy, setBusy] = useState(false)
  const [lastMs, setLastMs] = useState<number>()
  // The running turn's controller. A ref, because changing it must not redraw anything.
  const turn = useRef<AbortController | null>(null)

  useInput((input, key) => {
    if (!key.ctrl || input !== 'c') return
    if (turn.current) turn.current.abort()
    else exit()
  })

  async function submit(prompt: string) {
    const controller = new AbortController()
    turn.current = controller
    setBusy(true)
    try {
      for await (const event of run(prompt, controller.signal)) {
        setView((v) => apply(v, event))
        if (event.type === 'turn.complete') setLastMs(event.durationMs)
      }
    } finally {
      turn.current = null
      setBusy(false)
    }
  }

  return (
    <Box flexDirection="column">
      <Transcript done={view.done} live={view.live} />
      <Input onSubmit={submit} isActive={!busy} />
      <StatusBar model={model} cwd={cwd} busy={busy} lastMs={lastMs} />
    </Box>
  )
}
```

*TypeScript here: [`useRef<AbortController | null>`](./ts/phase-3b.md#ts-3) ·
[`useState<number>()` with no starting value](./ts/phase-3b.md#ts-4).*

- `apply`, `View` and `Transcript` are unchanged from 3a. Only `RunTurn` gains a `signal`.
- `turn` is a ref, not state. Setting it should not redraw anything, and the Ctrl+C handler must see
  the current controller, not the one from an older render.
- The controller is cleared in `finally`, so a turn that ends any way at all makes the next Ctrl+C
  a quit again.
- An aborted turn still finishes properly. The loop yields `turn.complete` with reason `aborted`,
  and `apply` shows `turn ended: aborted`.

### 4. bin/shrek.ts

**Why.** Two changes: `run` takes the signal and passes it to `runAgent`, and Ink is told to leave
Ctrl+C to us.

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

  async function* run(prompt: string, signal: AbortSignal): AsyncGenerator<AgentEvent> {
    for await (const event of runAgent({
      client,
      model: config.model,
      registry,
      prompt,
      history,
      signal,
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

  const props = { run, model: config.model, cwd: process.cwd() }
  // Ctrl+C is ours now: App decides whether it stops a turn or quits.
  const app = render(createElement(App, props), { exitOnCtrlC: false })
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

- Without `exitOnCtrlC: false`, Ink quits on Ctrl+C before `App`'s handler is ever reached.
- `runAgent` already accepted `signal` in Phase 1a, and every tool already gets it through
  `ToolContext`. Nothing in the loop changes for any of this.

### 5. Commit

```sh
bun test
bun run typecheck
git add -A
git diff --cached | grep -iE 'sk-or-|api[_-]?key'
git commit -m "phase 3b: input history, paste, status bar, ctrl+c"
```

---

## Test

```sh
bun run dev
```

1. Ask `read package.json and tell me only its name field`. The status bar says
   `working, ctrl+c to stop`, then `last turn 6.1s, ctrl+c to quit` (your number will differ).
2. Ask a follow-up: `what version does that same file say?`. Tool lines render as in 3a.
3. Copy these three lines and paste them into the box:
   ```
   first line
   second line
   third line
   ```
   The box grows to three lines. Nothing is sent until you press Enter.
4. Press Enter, then Ctrl+C within a second or two. Expect `turn ended: aborted` and the box back.
5. Press Up. The three lines come back. Up again gives the version question.
6. Ctrl+C with nothing running. You are back in your shell, and the cursor is visible.

Check the transcript ended the aborted turn properly:

```sh
D=~/.shrek/projects/$(printf '%s' "$PWD" | tr -cs 'A-Za-z0-9' '-')
F=$(ls -t "$D"/*.jsonl | head -1)
jq -r 'select(.type == "turn.complete") | .reason' "$F"
```

```
answer
answer
aborted
```

### Deliberate failure: let Ink keep Ctrl+C

In `bin/shrek.ts`, change `{ exitOnCtrlC: false }` to `{}`. Ask something and press Ctrl+C while it
works.

The whole app exits. Run the `jq` lines again. That turn has no line at all, not even `aborted`. The
process died before the turn could write its end. That is round 1 again: Ink took the key before `App` saw it. Put the option back.

---

## Gotchas

- **Two `useInput` hooks both get every key.** `App`'s and `Input`'s run side by side. That is why
  `Input` ignores `key.ctrl`; otherwise Ctrl+C would also type a `c` into the box.
- **An aborted turn stays in `history`.** Your question is in it, with maybe a half-done tool call.
  The model sees it next turn, which is usually what you want ("no, do it differently").
- **`usePaste` needs a terminal that supports bracketed paste.** macOS Terminal, iTerm2, VS Code and
  Ghostty all do. Where it is missing, pastes fall back to round 2's behaviour.
- **Stopping is not instant.** The abort cancels the model request and tells tools to stop, but a
  tool that ignores `ctx.signal` runs to the end first. Phase 1a's Bash does honour it.

---

## Recap

The input box keeps what you sent and takes multi-line pastes. A status line shows the model, the
folder and what Ctrl+C will do. Ctrl+C is a key `App` handles. It aborts the running turn through
the same `AbortSignal` `-p` uses, and quits only when nothing is running.

1. Why does `runPrint`'s `process.on('SIGINT', ...)` never fire inside the TUI?
2. Why is the turn's `AbortController` kept in a ref instead of state?
