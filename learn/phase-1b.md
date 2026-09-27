# Phase 1b: transcript and debug log

About forty-five minutes. Two small files and two small edits.

This is the second half of Phase 1. Part a left you with a working loop: `shrek -p "..."` asks a
model a question, the model asks for shell commands, shrek runs them and feeds the output back, and
the answer prints. Everything it does is forgotten the moment the process exits.

---

## What we are building

Today shrek starts keeping records. Two of them, in two files, for two different readers.

```sh
shrek -p "what is the current git branch?"
ls ~/.shrek/projects/-Users-you-repo-shrek-code/
```

After this, that second command lists a file named after the session, and inside it is every
message that went into the array, one per line, in order. Run the same command with `--debug` and
you also see the raw request and response go past on your screen.

### Where part b fits

Part a's loop is correct and amnesiac. Nothing about it is wrong, it simply keeps no record, and
three later phases cannot exist without one:

- Phase 7 adds `shrek --resume`, which reads a session file back and continues the conversation.
- Phase 11 shortens a long conversation by replacing the middle of the array with a summary, and
  the file is where it reads the middle from.
- Phase 21 is a long capstone run that will go wrong in ways you cannot watch live, so the only way
  to find out what happened is to read the logs afterwards.

Part b writes both files. Nothing reads them back until Phase 7, and that is fine. Today's job is
to make sure that what lands on disk is the thing those phases need, because the one thing you
cannot do in Phase 7 is go back and add fields to conversations already saved.

### The files you are about to write

| File | In React terms | Its job |
|---|---|---|
| `src/log.ts` | `console.log` with a file behind it | raw requests and responses, for when it breaks |
| `src/session/jsonl.ts` | nothing in React, it is new | append every message to a file on disk |
| `src/agent/loop.ts` | an edit, six lines | tell the transcript and the log what happened |
| `bin/shrek.ts` | an edit, four lines | open the transcript, turn on `--debug` |

> **New to TypeScript?** [`learn/ts/phase-1b.md`](./ts/phase-1b.md) explains every
> TypeScript construct this phase uses, in the order it appears, using these same pieces of code.
> The code blocks below link into it. You do not need it to finish the phase; it is there for when
> a line of syntax is in the way of the idea.

---

## What you'll learn

- **Append-only is a design, not a detail.** A file you can only add to is cheap to write, safe to
  crash during, and readable while it is being written. Each of those properties is load-bearing
  later.
- **Store the raw thing, derive the pretty thing.** The transcript holds the message objects
  exactly as they went into the array, because a format designed for reading back is worth more
  than one designed for looking at.
- **Logging is the one honest exception to passing config down.** Phase 0 said no module-level
  state. Today you write some, on purpose, and you will be able to say why.
- **Diagnostics go to stderr.** This is what keeps `shrek -p "..." | pbcopy` working.

---

## From the course

There is nothing in `../learn-claude-code/s01_agent_loop/code.py` to translate today. Its
conversation is a Python list called `history`, declared in the `__main__` block and passed into
`agent_loop`, and when the process exits it is gone. That is correct for a chapter whose point is
the loop.

The standards reference is `../claude-code/mods/types/claude-code.d.ts`, and it has two things
worth taking.

The first is that the transcript is a public path, not an internal detail. Every classic hook in
the real engine receives this, whatever the event:

```ts
type BaseHookInput = {
    session_id: string;
    transcript_path: string;
    cwd: string;
    ...
};
```

Three facts on every single hook invocation, and one of them is where the conversation lives on
disk. A hook that wants the history does not ask the engine for it, it opens the file. That is only
possible because the format is stable and readable by something that is not the engine. shrek's
`Transcript` returns its `path` for the same reason, and Phase 5's hooks will pass it along.

The second is a warning about shape. `$.session.messages()` does not hand back wire messages:

```ts
export type SessionMessage = {
    role: 'user' | 'assistant';
    text: string;
    toolUses: ToolUseSummary[];
    toolResults?: ToolResultSummary[];
};
```

Note `text`, described in the declaration as "Its text blocks joined". That is a summary built for
a hook author to read, and it has thrown away the information needed to send the conversation back
to a model. The real engine keeps both: the raw transcript on disk, and this friendly view derived
from it.

Take the ordering from that. **Write the raw messages, derive any friendly view later.** If you
store the pretty version today, Phase 7's resume has to reconstruct wire messages out of prose, and
it cannot, because `tool_call_id` is not in the prose.

---

## Anthropic to OpenAI translation

Nothing new goes over the wire in part b, so there is no new row for the standing table. There is
one consequence of it worth naming, because it will look like a bug in Phase 7.

Your transcript holds OpenAI-shaped messages. `{ role: 'tool', tool_call_id, content }`, and
assistant messages with a `tool_calls` array. The course's transcripts, if it had any, would hold
Anthropic-shaped ones with `tool_use` blocks nested inside `content` lists.

So a shrek transcript can be replayed into OpenRouter and nowhere else, and a Claude Code
transcript cannot be replayed into shrek. The formats are close enough to look interchangeable and
they are not. `~/.claude/projects/` and `~/.shrek/projects/` sit next to each other on your disk
using the same slug rule from Phase 0, which makes them easy to compare and impossible to swap.

The alternative is storing a provider-neutral format and converting on the way in and out. Real
products do that once they support more than one provider. It costs a conversion layer with two
sides that can disagree, and shrek talks to exactly one API. Store what you send.

---

## Background

**Why JSONL and not one JSON array.** JSONL is one complete JSON value per line, and the file as a
whole is deliberately not valid JSON. To add a message you append a line, with no reading and no
rewriting, so writing costs the same on message two and message two hundred. A JSON array has to
be parsed, extended and written back whole every time, which is quadratic work and, worse, has a
moment in the middle where the file on disk is neither the old version nor the new one. If the
process dies in that moment the conversation is gone. With JSONL a kill mid-write loses the last
line and every line before it is still readable. You also get `tail -f` on a live session and `jq`
line by line for free.

**Why append-only and never edit.** Nothing in shrek ever rewrites a transcript line. Phase 11
compacts a conversation by writing new lines that say a summary replaced a range, not by deleting
the range. The reason is that two things can hold the same file open, which happens the first time
you run a second shrek in a second terminal, and appends from two writers interleave safely while
rewrites destroy each other. It also means a transcript is an audit trail rather than a current
state, so you can see what happened rather than only what is true now.

**Why the messages are stored verbatim.** The `write('message', { message })` call stores the
object exactly as it went into the array. Resuming in Phase 7 becomes: read the file, keep the
lines where `type` is `message`, take `.message` from each, and you have the array back. No
conversion, nothing lost, no parser. The temptation is to store something tidier, because a raw
assistant message with a `tool_calls` array is ugly when you `cat` the file. Tidiness costs you
`tool_call_id`, and without it the array cannot be sent anywhere.

**Why the debug log is a separate file.** The transcript is the conversation and is meant to be
replayed. The debug log is the wire: whole request bodies, whole response bodies, errors, and
nothing replays it. They have different readers and different lifetimes. You can delete the debug
log at any moment and lose nothing, while deleting a transcript loses a conversation. Merging them
makes the transcript unparseable and the debug log unreadable at the same time.

**Why the logger is allowed to be a global.** Phase 0's rule was that config is computed once and
passed down as an argument, like props. The logger breaks it. The alternative is threading a logger
through `runAgent`, into `ToolContext`, and down into every tool Phase 2 adds, so the leaves of the
call tree can write a line. Logging is the standard exception to dependency injection because it is
needed everywhere and depended on by nothing. Nothing branches on what the logger did, so a wrong
logger cannot produce a wrong answer.

---

## Worked example

Part a's test run really did produce a conversation. Today you predict what that conversation looks
like once it is a file, before you write the code that writes it.

The run is `shrek -p "what is the current git branch?"`, the model calls Bash once, and the answer
is `main`.

### Round 1: how many lines, and in what order

Predict the sequence of lines in the session file.

<details><summary>Predict, then open</summary>

Six.

```
session
message  role: system
message  role: user
message  role: assistant   (content null, one tool_call)
message  role: tool        (tool_call_id, content "main")
message  role: assistant   (content "main", no tool_calls)
```

Five messages, because that is exactly the five-entry array you traced in round 4 of part a. Plus
one `session` line at the top, written when the file is opened, which is what guarantees a file is
never zero bytes and always records which directory it belonged to.

The ordering falls out of writing on append rather than at the end. Each line lands as its message
joins the array, so the file is correct even for a run that never finishes.
</details>

### Round 2: when does each line get written

The loop pushes messages in three different places: two before the first request, one per response,
one per tool call. Predict where the write happens, and what you would have to do to guarantee the
file's order matches the array's order.

<details><summary>Predict, then open</summary>

At every push, and nowhere else. Every `messages.push` gets a write beside it.

Which is the argument for not having three of them. In part a you wrote `messages.push(...)` in
three places. Today the first step of the edit is to replace all three with one local function:

```ts
async function add(message: ChatCompletionMessageParam): Promise<void> {
  messages.push(message)
  await opts.onMessage?.(message)
}
```

Now there is one place that can forget, rather than three, and adding a fourth push in Phase 2
cannot silently skip the transcript.

The `await` is what keeps the order. `appendFile` without awaiting returns a promise immediately,
and two unawaited appends racing each other can land in either order. The cost is one file write
per message on the critical path, roughly a tenth of a millisecond, against a network request that
takes two seconds.
</details>

### Round 3: the run that ends badly

The model asks for a command, the command times out and is killed, and the turn ends with
`reason: 'error'`. Predict what is in the file.

<details><summary>Predict, then open</summary>

Every line up to and including the `tool` message holding
`Error: command killed by SIGKILL after 120s: ...`. Then nothing. No final assistant message,
because there never was one.

That file is still valid and still resumable. The array it holds is complete: every assistant
message has its tool results, so Phase 7 can read it, send it, and the model will pick up from the
timeout and try something else.

Now the version that is not resumable. Suppose you had put the write after `execute` returned
instead of on every push, and `execute` had thrown. The assistant message with the tool call is on
disk, its result is not, and that file is permanently unsendable for the reason the translation
section of part a gave. This is why part a's rule was that nothing may escape between pushing the
assistant message and pushing its results. Part b makes the consequence permanent.
</details>

### Round 4: which file answers which question

You run shrek and the answer is confidently wrong. Say which file you open for each of these.

1. Did the model actually see the output of the command?
2. Did the request even leave the machine?
3. Did the model reply with text, or did the wrapper lose it?
4. What did the model say in the run before the one that broke?

<details><summary>Predict, then open</summary>

1. Transcript. The `tool` message is in there verbatim and either holds the output or does not.
2. Debug log. The transcript never mentions the network.
3. Debug log. The transcript holds the message shrek decided to keep, and the log holds the raw
   response body it came out of, which is how you tell "the model said nothing" from "we dropped
   it".
4. Transcript, the previous session file. The debug log is one shared file with no session
   boundaries in it, and after a day of work you will not be able to find a run in it.

That last one is a real limitation of `shrek.log` and it is deliberate. Phase 7 gives sessions
proper identity. The debug log stays a firehose because its job is to be complete, not tidy.
</details>

---

## Your task

Five steps.

### 1. src/log.ts

**Why.** In Phase 6 you will watch a stream produce nothing, and this file is how you find out
whether the request ever left. Phase 21 reads it to work out why the capstone stalled.

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

That `let alsoToStderr` is the module-level mutable state the background section argued for. It is
the only one in the project.

The empty `catch` is the only one you should ever write here. Every other swallowed error is a bug.
This one is the rule that a failure in the thing that reports failures must not become the failure.

`logsDir()` already exists on disk because `ensureStateDir()` runs in `bin/shrek.ts` before any of
this. That is a real dependency between two files, and the `catch` is what stops it being a crash
if it is ever broken.

`JSON.stringify` on a whole response object is deliberate. It is not readable as it goes past, and
it is exactly readable by `jq` afterwards, which is the reading that matters.

### 2. src/session/jsonl.ts

**Why.** This file is the conversation on disk. Phase 7 resumes from it and Phase 11 compacts it.

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

`appendFile` and not `Bun.file(path).writer()`. The writer truncates the file when it opens it,
which is the correct behaviour for writing a file and the wrong one for adding to a log. You will
find this out by watching a transcript contain only its last message.

Every line carries four fields before anything specific to it: `type`, `uuid`, `timestamp` and
`sessionId`. The per-line `uuid` is unused today. Phase 11 needs to say which lines a summary
replaced and Phase 13 refers to individual entries, and you cannot retrofit ids onto files already
written.

`write` takes a `type` and a bag of fields rather than a `TranscriptLine` union, because Phase 7
adds line types and Phase 11 adds more, and a union here would mean editing this file each time. It
is the one place in shrek where an open shape is the right call, and the reason is that this file
is a format rather than an interface.

`path` comes back in the returned object because of the `transcript_path` argument from the
standards section. Phase 5's hooks need to be told where the file is.

### 3. src/agent/loop.ts, six lines

**Why.** The loop is the only thing that knows what went into the array, so it is the only thing
that can report it.

Add `onMessage` to `RunOptions`:

```ts
  /** Called for every message added to the array, in order. The transcript writer. */
  onMessage?: (message: ChatCompletionMessageParam) => Promise<void>
```

Import the logger:

```ts
import { debug } from '../log'
```

Replace the array literal and the two `messages.push` calls with the single `add` from round 2 of
the worked example:

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
Three pushes become three `add`s and there is now one place that could forget.

Finally, three `debug` calls around the request:

```ts
      await debug('request', { model: opts.model, step, messages })
      const response = await opts.client.chat.completions.create(...)
      await debug('response', response)
```

and one in the `catch`:

```ts
      await debug('error', { message: answer })
```

Log the whole `messages` array on every request, not a count. It is verbose and it is the only way
to answer "what did the model actually see", which is the question you will have. The debug log is
allowed to be enormous. Delete it whenever you like.

Note what the loop still does not know. `onMessage` is optional and the loop never imports
`jsonl.ts`. Phase 9's sub-agents run this same loop and write nothing, by passing nothing.

### 4. bin/shrek.ts, four lines

**Why.** Somebody has to open the transcript and decide whether `--debug` is on, and that is the
entry point's job.

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

`config.debug || argv.includes('--debug')` is the layered config from Phase 0 with a fourth layer
on top, the command line, which beats the environment because it is the most local thing you can
type. `SHREK_DEBUG=1` turns it on for a shell, `--debug` turns it on for one run.

`onMessage` is a one-line arrow, not a method reference. It is where the loop's vocabulary
(`message`) meets the transcript's vocabulary (`type` and `fields`), and that translation is the
entry point's business rather than either file's.

### 5. Commit

```sh
bun run typecheck
git add -A
git diff --cached | grep -iE 'sk-or-|api[_-]?key'
git commit -m "phase 1b: transcript and debug log"
```

That finishes Phase 1.

---

## Test

```sh
bun run bin/shrek.ts -p "what is the current git branch?"
ls -t ~/.shrek/projects/*shrek-code/ | head -1
```

The answer prints as it did in part a, and the `ls` names a file like
`9f3c1a20-4b7e-4c8a-9c21-6f0e2b8d4a11.jsonl`. Now read it back:

```sh
F=$(ls -t ~/.shrek/projects/*shrek-code/*.jsonl | head -1)
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

That is round 1 of the worked example, on disk. The exact number of `assistant` and `tool` lines
depends on how many commands the model ran, and the first and last lines do not.

Confirm the tool result really is in there, verbatim:

```sh
jq -r 'select(.message.role == "tool") | .message.content' "$F"
```

You should see `main`, or whatever your branch is. Then confirm the call ids match up, which is the
property everything in part a was protecting:

```sh
jq -r 'select(.message.tool_calls) | .message.tool_calls[].id' "$F"
jq -r 'select(.message.role == "tool") | .message.tool_call_id' "$F"
```

Two lists, same ids, same order. If the second is shorter than the first, you have found a real bug
and that transcript cannot be resumed.

### The debug log

```sh
bun run bin/shrek.ts --debug -p "echo hello" 2>&1 >/dev/null | head -3
```

`2>&1 >/dev/null` keeps stderr and throws stdout away, so you see only the diagnostics. You should
see a `request` line, a `response` line, and no answer. Then check the same lines landed in the
file:

```sh
jq -r '.tag' ~/.shrek/logs/shrek.log | tail -5
```

`request`, `response`, and possibly `error`.

### Deliberate failure: a truncating writer

Change `appendFile` in `jsonl.ts` to the thing that looks equivalent:

```ts
await Bun.write(path, `${JSON.stringify(line)}\n`)
```

Run the test again and read the file:

```sh
wc -l "$F"
```

One line, the last message, and every earlier one gone. `Bun.write` replaces a file's contents.
Change it back. This is worth doing once because the failure is silent: nothing errors, the run
looks perfect, and you only find out when Phase 7 resumes a conversation that has no beginning.

- If you get more than one line, check you are reading the newest file, not the one from the
  previous test.

### Deliberate failure: an unwritable log directory

```sh
chmod a-w ~/.shrek/logs
bun run bin/shrek.ts -p "echo still works"; echo "exit $?"
chmod u+w ~/.shrek/logs
```

Expect a normal answer and `exit 0`. The empty `catch` in `log.ts` is doing its job.

- A crash mentioning `EACCES` means the `try` is missing or is not wrapping the `appendFile`.
- Note that the transcript has no such `catch` on purpose. A transcript that cannot be written is a
  conversation being silently lost, which is worth stopping for. A debug line is not.

---

## Notes and gotchas

**`appendFile` and not `Bun.file().writer()` or `Bun.write()`.** Both of the latter truncate. Bun's
`FileSink` is the faster option for many small writes and it needs the file opened for append
explicitly. At one write per message, `appendFile` is not the bottleneck.

**Transcript folders start with a hyphen.** `-Users-you-repo-shrek-code`, from Phase 0's slug rule.
`rm -rf -Users-...` fails because `rm` reads the leading `-` as a flag. Use `rm -rf -- <folder>`.

**`jq` may not be installed.** `brew install jq`. It is worth it: every file shrek writes from here
to Phase 21 is JSONL, and reading them with `grep` is miserable.

**The debug log grows without limit.** No rotation, no cap. A long Phase 21 run will produce
hundreds of megabytes, because every request logs the entire message array and the array grows on
every round. Deleting it is always safe. Rotation is not worth building until something depends on
history being kept, and nothing does.

**Do not log the API key.** `debug('request', ...)` logs the request body, which does not contain
the key. The key lives in a header, and the moment you start logging headers to chase a 401, redact
it. The debug log is the second thing people paste into a bug report.

**One `tool_call_id` per `tool` message, still.** Part a's rule is now permanent: a run that breaks
it writes a transcript that cannot be resumed. The `jq` id check in the test above is the fastest
way to confirm a transcript is sound, and it is worth rerunning after Phase 2 makes the tool loop
parallel.

**`crypto.randomUUID()` needs no import in Bun.** It is a global, and the same call works in the
browser. If TypeScript disagrees, `types: ["bun"]` is missing from `tsconfig.json`.

**Sessions are one per process today.** Every run of `shrek -p` writes a new file, so a day of
testing leaves dozens. Phase 7 adds `--resume` and `--continue`, which is where a session becomes
something you return to instead of something you produce.

---

## Recap

`src/log.ts` writes one JSON line per event to `~/.shrek/logs/shrek.log` and tees to stderr when
`--debug` or `SHREK_DEBUG` is on. It holds the raw request and response bodies, it never throws,
and nothing ever reads it back. It is the only module-level mutable state in the project and the
reason is that logging is needed everywhere and depended on by nothing.

`src/session/jsonl.ts` opens one file per session under `~/.shrek/projects/<slug>/`, named by a
UUID, and appends one line per message with `type`, `uuid`, `timestamp` and `sessionId` on every
one. Messages are stored exactly as they went into the array, so Phase 7 resumes by reading lines
and Phase 11 compacts by writing more of them.

The loop gained one optional `onMessage` callback and one place, `add`, where a message joins both
the array and the record. It still does not know what a transcript is, which is what lets Phase 9's
sub-agents run the same loop and keep no record at all.

Three questions to check you got it.

1. The transcript's `appendFile` has no `try`/`catch` and the debug log's does. Say why, and give
   the rule that decides it for the next file that writes to disk.

2. A run ends with a timed-out command and no final answer. Explain why that transcript is still
   resumable, and describe a code change to part a's loop that would make it not resumable.

3. `write(type, fields)` takes an open bag of fields instead of a typed union of line shapes,
   which is the opposite of the choice `events.ts` made for `AgentEvent`. Both are right. What is
   the difference between the two cases?

---

Phase 1 is done. shrek answers questions by running commands, and it remembers. Phase 2 gives the
model Read, Write, Edit, Glob and Grep, so it can change a codebase rather than only describe one,
and the loop you wrote does not change by a single line.
