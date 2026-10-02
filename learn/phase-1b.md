# Phase 1b: transcript and debug log

About forty-five minutes. Two small files and two small edits.

---

## The big picture

After 1a the loop works, but everything is forgotten the moment shrek exits.

After 1b every run leaves two records:

```sh
shrek -p "what is the current git branch?"
ls ~/.shrek/projects/-Users-youruser-repo-your-agent/
```

That folder now holds one file per session, with every message from the array, one per line.
Add `--debug` and you also see the raw request and response go past.

Who needs this later: Phase 7's `--resume` reads the transcript back into the array. Phase 11
compacts long conversations from it. Phase 21 debugs a long failed run by reading the debug log
afterwards. Nothing reads the files today, but what you save now is all those phases will ever have.

## Files

| File | Job |
|---|---|
| `src/log.ts` | raw requests and responses to `~/.shrek/logs/shrek.log`, for when it breaks |
| `src/session/jsonl.ts` | append every message to a session file |
| `src/agent/loop.ts` | edit: report each message as it joins the array |
| `bin/shrek.ts` | edit: open the transcript, turn on `--debug` |

TypeScript help for this phase: [`learn/ts/phase-1b.md`](./ts/phase-1b.md).

---

## Remember this

> Two files, two jobs. The **transcript** is what was said: the exact messages from the array, so
> it can be replayed. The **debug log** is what went over the wire: raw bodies, so you can see
> what broke. Both are append-only: you only ever add lines, never rewrite, so a crash loses at
> most the last line.
>
> **Transcript = replay. Debug log = diagnose.**

---

## Why

**JSONL, not one JSON array.** JSONL is one JSON object per line. Adding a message means appending
one line: no reading, no rewriting, and a crash mid-write only loses that line. A JSON array must
be rewritten whole each time, and dying halfway loses everything.

**Store the raw messages.** The transcript holds each message exactly as it went into the array.
Resume is then "read lines, rebuild array". A tidier format would drop `tool_call_id`, and without
it the array can't be sent again.

**The logger is a global, on purpose.** Phase 0 said pass config down like props. Logging is the
exception: every file needs it, and nothing's behavior depends on it.

---

## Worked example

The run: `shrek -p "what is the current git branch?"`. The model calls Bash once, the answer is
`main`.

### Round 1: what is in the session file?

<details><summary>Predict, then open</summary>

Six lines:

```
session
message  role: system
message  role: user
message  role: assistant   (content null, one tool_call)
message  role: tool        (tool_call_id, content "main")
message  role: assistant   (content "main", no tool_calls)
```

The five messages from 1a's array, plus a `session` header written when the file opens. Each line
is written the moment its message joins the array, so even a run that crashes leaves a correct
file up to that point.
</details>

### Round 2: which file answers which question?

1. Did the model actually see the command's output?
2. Did the request even leave the machine?
3. What did the model say in yesterday's run?

<details><summary>Predict, then open</summary>

1. Transcript. The `tool` message is there verbatim.
2. Debug log. The transcript never mentions the network.
3. Transcript, the older session file. The debug log is one shared file with no session boundaries.
</details>

---

## Your task

Five steps.

### 1. src/log.ts

**Why.** When a request silently produces nothing (you'll hit this in Phase 6), this is how you see
whether it ever left.

```ts
import { appendFile } from 'node:fs/promises'
import { join } from 'node:path'
import { logsDir } from './paths'

let alsoToStderr = false

/** Called once, from `bin/shrek.ts`. */
export function enableDebug(on: boolean): void {
  alsoToStderr = on
}

/** One JSON line in `~/.shrek/logs/shrek.log`. Never throws. */
export async function debug(tag: string, data: unknown): Promise<void> {
  const line = JSON.stringify({ at: new Date().toISOString(), tag, data })
  if (alsoToStderr) process.stderr.write(`${line}\n`)
  try {
    await appendFile(join(logsDir(), 'shrek.log'), `${line}\n`, 'utf8')
  } catch {
    // A broken log must never take down a working agent.
  }
}
```

*TypeScript here: [`let` inference and mutable module state](./ts/phase-1b.md#ts-4) ·
[`catch` with no binding](./ts/phase-1b.md#ts-5).*

- The empty `catch` is the only one you should ever write: a broken logger must not crash the agent.

### 2. src/session/jsonl.ts

**Why.** The conversation on disk. Phase 7 resumes from it and Phase 11 compacts it.

```ts
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
```

*TypeScript here: [`Record<string, unknown>` as a deliberate choice](./ts/phase-1b.md#ts-2) ·
[structural typing and closures](./ts/phase-1b.md#ts-3) ·
[where `crypto` and `Bun` come from](./ts/phase-1b.md#ts-6).*

- `appendFile`, not `Bun.write`. `Bun.write` replaces the file, so you'd keep only the last message.
- Every line gets its own `uuid` now, because Phase 11 needs to point at lines and you can't add
  ids to old files later.

### 3. src/agent/loop.ts, six lines

**Why.** Only the loop knows what goes into the array, so only it can report it.

Add `onMessage` to `RunOptions`:

```ts
  /** Called for every message added to the array, in order. The transcript writer. */
  onMessage?: (message: ChatCompletionMessageParam) => Promise<void>
```

Import the logger:

```ts
import { debug } from '../log'
```

Replace the array literal and the `messages.push` calls with one `add` function:

```ts
  const messages: ChatCompletionMessageParam[] = []
  async function add(message: ChatCompletionMessageParam): Promise<void> {
    messages.push(message)
    await opts.onMessage?.(message)
  }

  await add({ role: 'system', content: systemPrompt(cwd) })
  await add({ role: 'user', content: opts.prompt })
```

*TypeScript here: [optional callbacks and `?.()`](./ts/phase-1b.md#ts-1).*

then `await add(message)` where the assistant message was pushed, and
`await add({ role: 'tool', tool_call_id: call.id, content: output })` where the tool message was.

Three `debug` calls around the request:

```ts
      await debug('request', { model: opts.model, step, messages })
      const response = await opts.client.chat.completions.create(...)
      await debug('response', response)
```

and one in the `catch`:

```ts
      await debug('error', { message: answer })
```

- One `add` means one place that could forget to save, not three.
- The `await` keeps lines in order; two unawaited appends can land swapped.
- The loop never imports `jsonl.ts`. Phase 9's sub-agents pass no `onMessage` and save nothing.

### 4. bin/shrek.ts, four lines

**Why.** The entry point decides whether to record and whether `--debug` is on.

```ts
import { enableDebug } from '../src/log'
import { openTranscript } from '../src/session/jsonl'
```

In `main`, right after `ensureStateDir()`:

```ts
  enableDebug(config.debug || argv.includes('--debug'))
```

In `runPrint`, before the loop, and passed in:

```ts
  const transcript = await openTranscript()

  for await (const event of runAgent({
    client,
    model: config.model,
    tools: [bash],
    prompt,
    signal: controller.signal,
    onMessage: (message) => transcript.write('message', { message }),
  })) {
```

- `--debug` is a fourth config layer on top of Phase 0's three: the command line wins.

### 5. Commit

```sh
bun run typecheck
git add -A
git diff --cached | grep -iE 'sk-or-|api[_-]?key'
git commit -m "phase 1b: transcript and debug log"
```

---

## Test

```sh
bun run bin/shrek.ts -p "what is the current git branch?"
D=~/.shrek/projects/$(printf '%s' "$PWD" | tr -cs 'A-Za-z0-9' '-')
F=$(ls -t "$D"/*.jsonl | head -1)
jq -r '.type + " " + (.message.role // "")' "$F"
```

```
session 
message system
message user
message assistant
message tool
message assistant
```

Check every call got its answer, same ids, same order:

```sh
jq -r 'select(.message.tool_calls) | .message.tool_calls[].id' "$F"
jq -r 'select(.message.role == "tool") | .message.tool_call_id' "$F"
```

And the debug log:

```sh
bun run bin/shrek.ts --debug -p "echo hello" 2>&1 >/dev/null | head -3
jq -r '.tag' ~/.shrek/logs/shrek.log | tail -5
```

You see `request` and `response` lines.

### Deliberate failure: a truncating writer

Swap `appendFile` in `jsonl.ts` for `await Bun.write(path, `${JSON.stringify(line)}\n`)`, rerun,
and `wc -l "$F"`. One line: every earlier message is gone, and nothing reported an error. Change it
back.

---

## Gotchas

- **Folder names start with a hyphen.** `rm -rf -Users-...` reads it as a flag. Use `rm -rf -- <folder>`.
- **Install `jq`** (`brew install jq`). Every file shrek writes from here on is JSONL.
- **The debug log grows forever.** It's always safe to delete.
- **Never log headers.** The API key lives there. Request bodies are safe.

---

## Recap

`log.ts` writes raw wire traffic to one shared file and never throws. `jsonl.ts` writes one file
per session with every message exactly as sent. The loop reports each message through one `add`
function and still doesn't know what a transcript is.

1. The transcript's `appendFile` has no `try` but the debug log's does. Why?
2. A run ends with a timed-out command and no final answer. Is the transcript still resumable?

Phase 1 is done. Phase 2 gives the model real file tools, and the loop barely changes.
