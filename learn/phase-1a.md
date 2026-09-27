# Phase 1a: agent loop

About an hour. Most of it is typing six small files.

Phase 1 is two sittings. This is the first. Part a builds the loop and gets an answer out of it.
Part b gives the loop a memory on disk. Stop at the end of this file and commit.

---

## What we are building

shrek is a coding agent that lives in your terminal. Today you make this work:

```sh
shrek -p "how many .ts files are in this repo?"
```

You will get back something like `7`. shrek does not count the files. It asks an AI model, the
model asks shrek to run `find . -name '*.ts' | wc -l`, shrek runs it and sends the output back, and
the model writes the answer. Two network requests, one shell command, one number.

That exchange is the product. The remaining twenty phases all wrap it: more tools, a permission
prompt, a React interface, sub-agents. The loop you write today is the thing all of them wrap, and
it does not change again.

### Where part a fits

Phase 0 gave shrek four answers: which model, which key, where conversations go, where logs go. It
prints them and exits. It has never sent a request.

Part a closes exactly that gap and nothing wider. After today shrek answers a question by running
shell commands. It still has no user interface (Phase 3), it cannot read or write a file except by
shelling out to `cat` and `echo` (Phase 2), it never asks your permission before running anything
(Phase 4), and it forgets everything the moment it exits (part b, in an hour). Those gaps are
deliberate. Today is only the loop.

### The files you are about to write

| File | In React terms | Its job |
|---|---|---|
| `src/tools/types.ts` | a props contract | what every tool must provide |
| `src/tools/bash.ts` | nothing in React, it is new | run a shell command, return its output as text |
| `src/agent/events.ts` | your Redux action types | the things the loop announces while it runs |
| `src/agent/systemPrompt.ts` | nothing in React, it is new | the standing instructions the model gets |
| `src/agent/loop.ts` | nothing in React, it is new | call the model, run the tools it asked for, repeat |
| `bin/shrek.ts` | `index.js`, the entry point | one edit, to add the `-p` flag |

> **New to TypeScript?** [`learn/ts/phase-1a.md`](./ts/phase-1a.md) explains every
> TypeScript construct this phase uses, in the order it appears, using these same pieces of code.
> The code blocks below link into it. You do not need it to finish the phase; it is there for when
> a line of syntax is in the way of the idea.

---

## What you'll learn

- **The loop is a state machine over one array.** There is no hidden agent state anywhere. An array
  of messages goes up, a longer array comes back, and the only decision the loop makes is whether
  to go round again.
- **A tool is data, not a function.** When Phase 2 adds five more tools, `loop.ts` does not change
  by a single line. That is what the `Tool<T>` shape buys you.
- **An async generator separates doing from showing.** The same loop feeds a Unix pipe today and a
  React render tree in Phase 3, because it never prints anything itself.
- **A tool failure is data, never an exception.** Getting this wrong corrupts the message array in
  a way that cannot be retried, and part b makes that corruption permanent by saving it.

---

## From the course

The source chapter is `../learn-claude-code/s01_agent_loop/`. Read `code.py` first. It is 130 lines
and you will recognise most of it.

Its structure, in four pieces:

- `TOOLS`, a list holding one hand-written JSON object describing a `bash` tool.
- `run_bash(command)`, which shells out, blocks a few dangerous strings, times out at 120 seconds
  and truncates at 50,000 characters.
- `agent_loop(messages)`, a `while True` that calls the model, appends the reply, looks for
  `tool_use` blocks, runs them, appends the results and goes round again. It returns when the model
  replies without asking for a tool.
- A `__main__` block holding a `history` list and reading lines from the terminal.

That loop is the whole idea and shrek keeps it exactly. Three things diverge on purpose.

**A `Tool<T>` interface instead of a JSON literal.** The chapter hard-codes `run_bash` inside the
loop because there is only ever one tool. Phase 2 adds five. With the chapter's shape that is five
edits to the loop and five branches in an `if name ==` chain. With a `Tool<T>` object the loop
looks tools up by name and never learns what any of them do.

**An async generator instead of `print()`.** The chapter prints from inside the loop, which works
exactly once, in a terminal the loop owns. Phase 3 draws the same information inside an Ink
component and Phase 6 streams it a token at a time. A loop that prints cannot be reused by either.

**An iteration cap.** `while True` assumes the model eventually stops asking for tools. A model
that keeps running `ls` in a slightly different directory forever is not hypothetical, and on a
paid model it is a bill. shrek stops after twenty rounds.

### The names to steal

The standards reference is `../claude-code/mods/types/claude-code.d.ts`, the real Claude Code
engine's type declarations. There is no loop in it to copy. What it has is names, and names chosen
by people who ran this loop in production are worth taking for free.

Four of them describe a **turn**, which is one user question and everything that happens until the
model answers it.

```ts
export type TurnStartInput = {
    text: string;
    turnId: string;
};

type TurnCompleteFields = {
    answer: string;
    durationMs: number;
    isAborted: boolean;
    turnId: string;
};

export type TurnCompleteReason = 'answer' | 'aborted' | 'refusal' | 'error';

'turn.abort': {
    turnId: string;
};
```

Two rules to take, one line of cost each.

**The turn id is minted once, at the start, and every later event carries it.** The declaration
file says so on `turnId`: "minted here; the same one every `turn.step` and the `turn.complete` of
this turn carry." Phase 3 runs things concurrently and needs to know which output belongs to which
question, and `$.turn.abort({ turnId })` needs a name for the turn to cut.

**A turn ends with a reason as well as text.** `answer`, `aborted` and `error` are three
genuinely different endings and your exit code depends on which one you got. Return only a string
and the caller cannot tell an answer from a crash that produced a nice apology.

shrek adds one reason the real engine does not have, `max_steps`, because the real engine bounds a
turn by other means. Keep it separate from `error` so today's test can tell them apart.

You are not building an event bus today. Nothing subscribes, the loop just yields a value and the
caller reads it. Phase 5 is the refactor that turns these four names into real events with
`($, e, next)` middleware. Because you name them right today, that phase changes the plumbing and
not the vocabulary.

---

## Anthropic to OpenAI translation

Recap from Phase 0, since this is the first phase where it bites. Anthropic and OpenAI each have
their own format for talking to a model. The course is written against Anthropic's. shrek talks to
OpenRouter, a middleman that accepts OpenAI-shaped requests and forwards them to whichever of
several hundred models you name. So every chapter needs translating.

| The course (Anthropic) | shrek (OpenRouter, OpenAI shape) |
|---|---|
| `response.content[]`, a list mixing text blocks and `tool_use` blocks | `choice.message.content`, a string or `null`, plus a separate `choice.message.tool_calls[]` |
| `block.input`, already a parsed object | `tool_call.function.arguments`, a **string** of JSON you must parse yourself |
| one `{role: 'user', content: [tool_result, tool_result]}` holding every result | one `{role: 'tool', tool_call_id, content}` message **per call** |
| `stop_reason === 'tool_use'` | `finish_reason === 'tool_calls'` |
| `system` is a top-level parameter | `system` is `messages[0]`, with `role: 'system'` |

**The failure this phase will hit.** Row three. An assistant message containing three `tool_calls`
must be followed by three `tool` messages, one per `tool_call_id`, before you send the array back.
Miss one and OpenRouter rejects the whole request:

```
400 An assistant message with 'tool_calls' must be followed by tool messages
responding to each 'tool_call_id'. The following tool_call_ids did not have
response messages: call_9Kq2xR
```

There are three ways to trip over this and all three feel reasonable while you are typing them. You
concatenate two outputs into one `tool` message, because Anthropic puts them in one message. You
let a tool throw, so the loop dies before appending anything. You skip a call whose arguments would
not parse. Rounds 6, 7 and 8 of the worked example are those exact cases.

The damage outlives the request. The broken array stays broken, so every retry sends the same
unanswered call and gets the same 400 forever.

---

## Background

**The message array is the whole state.** The model has no memory. Each request is judged entirely
on what is inside it, and the moment it replies it forgets everything. A chat window appears to
remember because it resends the whole conversation every time. So the array is not a log of the
conversation, it **is** the conversation, and the loop's only job is appending the right things in
the right order. Two consequences arrive later: costs grow quadratically because you pay for the
whole array on every round (Phase 7 puts a number on it), and eventually the array outgrows what
the model can hold (Phase 11 replaces its middle with a summary). A **token** is roughly three
quarters of a word and is the unit models are billed and measured in.

**A tool is an object, not a function.** The obvious design is a `runBash` function, plus a
hand-written JSON description to send the model, plus a branch in the loop. That is `code.py` and
it is right for one tool. At the second tool the description and the function drift apart: you add
an `offset` parameter and forget the schema, so the model never learns it exists. A shrek tool is
one object with a `name`, a `description` the model reads to decide when to call it, a `params`
Zod schema, and an `execute`. The Zod schema does three jobs at once. It is the JSON Schema sent to
the model, the runtime check on what comes back, and the source of the TypeScript type. Drift
becomes impossible rather than merely discouraged.

**The loop yields instead of prints.** An **async generator** is a function that hands back values
one at a time, over time, and the caller reads them with `for await`. You write `async function*`
with a star and `yield` instead of `return`. Today `bin/shrek.ts` turns events into plain lines.
Phase 3 turns the same events into Ink components. Phase 9 collects them from a sub-agent and shows
none of them. Three consumers, one producer, and the producer never learns about any of them. The
alternative is passing `onText` and `onToolStart` callbacks in, which works and goes wrong in a
specific way: callbacks fire whether or not the caller has finished with the last one. A generator
pauses at every `yield` until the caller asks for the next value, so a slow consumer slows the loop
rather than being flooded by it. Phase 6 is where you will care. Round 9 derives this from the run
itself, before any of the syntax.

**A tool failure is data.** A command that exits non-zero has not failed in any sense the loop
cares about. "It printed `command not found` and exited 127" is a complete and useful answer, and
models are good at reading those and trying something else. So `execute` returns a string on every
path and never throws, and neither does an unparseable argument, an unknown tool name, or a Zod
validation failure. The reason is the 400 above: the moment anything throws between appending the
assistant message and appending its tool results, the array holds a question with no answer and
stays that way. An exception is still right for things that are not the tool's fault, like the
network being down. A tool's own failure is data. A failure of the machinery around tools is an
exception.

---

## Worked example

Before any code, walk one complete exchange by hand. This is the whole of `loop.ts` done on paper.
Get it right and the code is an hour of typing rather than an evening of debugging.

The question is "how many .ts files are in this repo?". Cover the answers, predict, then open. The
Anthropic shape from `code.py` sits beside the OpenAI shape throughout.

### Round 1: you have typed the question and nothing has been sent

What is in `messages`?

<details><summary>Predict, then open</summary>

Two entries.

```ts
[
  { role: 'system', content: 'You are shrek, a coding agent running at /Users/you/repo ...' },
  { role: 'user', content: 'how many .ts files are in this repo?' },
]
```

The chapter's array has one entry, because Anthropic takes the system prompt as a separate
top-level argument rather than as a message:

```python
messages = [{"role": "user", "content": query}]
response = client.messages.create(system=SYSTEM, messages=messages, ...)
```

Mostly trivia, with one real consequence. Because the system prompt lives in the array, Phase 11's
compaction has to know never to throw it away.
</details>

### Round 2: you send it, and the model wants to run a command

Predict what you append.

<details><summary>Predict, then open</summary>

One message, the assistant's, pushed exactly as it arrived:

```ts
{
  role: 'assistant',
  content: null,
  tool_calls: [
    {
      id: 'call_9Kq2xR',
      type: 'function',
      function: {
        name: 'Bash',
        arguments: '{"command":"find . -name \'*.ts\' -not -path \'./node_modules/*\' | wc -l"}',
      },
    },
  ],
}
```

with `choices[0].finish_reason === 'tool_calls'`.

`content` is `null`. The model said nothing to you this round, it only asked for something, and a
naive `console.log(message.content)` prints the word `null`.

`arguments` is a **string**, not an object. You will call `JSON.parse` on it, and since a model
produced it, it is not guaranteed to parse.

`id` is how the answer gets matched to the question. Remember `call_9Kq2xR`. The format varies by
provider, and through OpenRouter you will see ids like `Bash_7xqwkqm0dea2` instead. Never construct
one or parse meaning out of one, just copy it back.

The chapter puts all of that inside one content list, with `input` already a dict and `stop_reason`
rather than `finish_reason`:

```python
response.content == [
    ToolUseBlock(type='tool_use', id='toolu_01A...', name='bash',
                 input={'command': "find . -name '*.ts' | wc -l"}),
]
```
</details>

### Round 3: you run the command and it prints `7`

Predict the next state of the array. How many entries, and what is the new one?

<details><summary>Predict, then open</summary>

Four entries. The new one:

```ts
{ role: 'tool', tool_call_id: 'call_9Kq2xR', content: '7' }
```

A role you have not seen before, and the `tool_call_id` copied exactly from round 2. That id is the
only thing linking an answer to its question.

Here is the most common mistake in translating this chapter. The chapter appends a **user**
message:

```python
messages.append({"role": "user", "content": [
    {"type": "tool_result", "tool_use_id": block.id, "content": output},
]})
```

so the obvious translation is `{ role: 'user', content: '7' }`. It does not error. It sends
cleanly. And the model, seeing a request for a command with no reply followed by a user saying `7`,
will usually run the command again or thank you for the number and ask what it was for. You will
read the transcript and conclude the model is stupid. It is not. You dropped the id.

| Anthropic | OpenAI |
|---|---|
| role is `user` | role is `tool` |
| results nest inside a `content` list | one message per result, flat |
| the key is `tool_use_id` | the key is `tool_call_id` |
</details>

### Round 4: you send all four messages and the model answers

<details><summary>Predict, then open</summary>

```ts
{ role: 'assistant', content: 'There are 7 TypeScript files in this repo.', tool_calls: undefined }
```

with `finish_reason === 'stop'`. `tool_calls` is absent, so the loop stops. That is the entire exit
condition.

Note what it is not. The loop does not read `finish_reason` to decide. Checking for the presence of
tool calls is the same test the chapter makes, and it survives the OpenRouter backends that report
`finish_reason` inconsistently.

Final array, five entries. Two requests were sent, and the second contained everything in the
first plus two more messages.
</details>

### Round 5: text and a tool call in the same reply

```ts
{
  role: 'assistant',
  content: "I'll count them for you.",
  tool_calls: [{ id: 'call_A1', type: 'function', function: { name: 'Bash', arguments: '...' } }],
}
```

What do you append, in what order?

<details><summary>Predict, then open</summary>

**One** message, the assistant message exactly as it arrived, holding both the text and the call.
Then the `tool` message after it.

Showing the text and appending the message are separate actions, and it is easy to do only one. The
failure: you notice `content` is non-empty, yield it as a text event, handle the tool calls, and
somewhere in that branch forget the `messages.push`. Now the array holds a `tool` message answering
a call that no message made. Same 400, different cause.

The rule that makes it impossible: **push the assistant message first, before you look at any part
of it.** One line at the top of the round, before any branching.
</details>

### Round 6: two commands at once

```ts
tool_calls: [
  { id: 'call_A1', function: { name: 'Bash', arguments: '{"command":"git branch --show-current"}' } },
  { id: 'call_B2', function: { name: 'Bash', arguments: '{"command":"git status --short"}' } },
]
```

The first prints `main`. The second prints nothing. Predict the array.

<details><summary>Predict, then open</summary>

Two `tool` messages, one per call, both of them, in the order the calls came:

```ts
{ role: 'tool', tool_call_id: 'call_A1', content: 'main' },
{ role: 'tool', tool_call_id: 'call_B2', content: '(no output)' },
```

Combining them into one message is the Anthropic shape leaking in, and it produces the 400 naming
`call_B2`.

Dropping the second because it printed nothing is the subtler error. Silence is meaningful, it is
how `git status --short` says the tree is clean. Send the literal `(no output)` rather than an
empty string, because some providers reject a `tool` message with empty content and because
`(no output)` is unambiguous to the model in a way that `""` is not.
</details>

### Round 7: the command fails

The model runs `tsc --noEmit` and gets `sh: tsc: command not found` with exit code 127. Predict the
tool message, then predict what happens if `execute` throws instead.

<details><summary>Predict, then open</summary>

A completely ordinary tool message:

```ts
{ role: 'tool', tool_call_id: 'call_C3', content: 'sh: tsc: command not found\n(exit code 127)' }
```

The loop does not care. It goes round again, the model reads `command not found`, and next round it
calls `bunx tsc --noEmit` instead. That recovery is the most useful behaviour an agent has and you
get it by passing the error through unchanged.

Include the exit code. Some commands fail silently with nothing on stderr, and without the code the
model sees an empty result and concludes the command worked.

If `execute` throws, the exception travels out of the loop and ends the process, leaving the array
holding an unanswered `call_C3`. Today that costs you one run. After part b, that broken array is
saved to disk, and resuming it in Phase 7 sends it straight back and 400s forever.
</details>

### Round 8: the arguments do not parse

The reply contains `{ id: 'call_D4', type: 'function', function: { name: 'Bash', arguments: '' } }`.
An empty string. Predict what you do.

<details><summary>Predict, then open</summary>

`JSON.parse('')` throws `SyntaxError: Unexpected end of JSON input`. Catch it and return a tool
message like:

```ts
{ role: 'tool', tool_call_id: 'call_D4', content: 'Error: arguments were not valid JSON: ""' }
```

Same as every other failure. A string, in a `tool` message, with the right id.

Not hypothetical. The free models in Phase 0's registry emit empty or truncated `arguments`
regularly, especially near their output limit, and telling the model what it sent is often enough
for it to send it properly next round.

Note the ordering this forces. Validation happens **after** the assistant message is in the array
and **before** anything is executed, and it produces a tool result either way. Rounds 5 through 8
are one lesson from four angles: between pushing the assistant message and pushing every one of its
tool results, nothing is allowed to escape.
</details>

### Round 9: why the loop hands values back one at a time

The array is settled. One thing in `loop.ts` is still unexplained, and it is the very first line of
the function: `export async function* runAgent(...)`, with a star after `function`, and a body that
says `yield` where you would expect `return`.

Work out why it is there before you meet the syntax. One run of the loop takes about thirty seconds:
a model call, a `find` that takes a moment, a second model call. Three things have to be true of it.

- The `$ find ...` line has to be on screen while the command is running, not after.
- Phase 3 draws the same information as Ink components and Phase 9 throws it away, so `runAgent`
  cannot know who is watching.
- A fourth value must never arrive while `runPrint` is still busy with the third.

You already know two ways for a function to give values to its caller. Predict what each one gets
wrong here.

<details><summary>Predict, then open</summary>

**Collect the events and `return` an array.** `runPrint` loops over it afterwards. Every event is
correct and all of them are thirty seconds late, so the user watches a blank terminal and then the
`$ find ...` line appears below the answer it produced. Phase 6 streams a reply a token at a time,
and an array cannot express that at all.

**Take callbacks.** `runAgent({ onText, onToolStart })`, and `runPrint` passes two functions in. This
one works, and it is what most people reach for from React. It goes wrong in two quieter ways.
`runAgent` now has to know the names of the things its callers care about, so Phase 3 and Phase 9
each add another parameter. And a callback fires whether or not the caller has finished with the last
one, so a slow consumer gets flooded instead of waited for, and you end up writing a queue.

What all three requirements want is a function that hands back one value, **stops there**, and
carries on only when the caller asks for another. JavaScript has exactly that, and the star is how
you ask for it: `function*` with `yield` instead of `return`. The consumer reads the values with
`for await`, which is the `for await` at the top of `runPrint`.

[TS-8](./ts/phase-1a.md#ts-8) is a program of about ten lines that you can run to watch a function
freeze on a `yield` and thaw on the next request. Run it before you type step 5. The rest of this
phase makes more sense once you have seen a function stop in the middle and wait.

One consequence to carry into part b. A yielded event has no home. `runPrint` reads one as `event`,
prints a line from it, and the next value overwrites the variable. Nothing in shrek keeps a list of
events. The array that is kept is `messages`, and that is the one part b writes to disk.
</details>

---

## Your task

Seven steps. In a second terminal, start `bunx tsc --noEmit --watch` and leave running; `--watch` re-checks on every save and prints `Found 0 errors`.

### 1. src/tools/types.ts

**Why.** This file is the contract every tool signs. Phase 2 adds five more tools against it and
`loop.ts` does not change, because the loop only ever sees this shape.

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

`execute` returns `Promise<string>` and not a union with an error type. Round 7 is why: a tool
failing is a string like any other, and the type makes that the only option rather than a habit.

`AnyTool` uses `any` on purpose and it is the only one in the project. `Tool<string>` and
`Tool<{command: string}>` have no common supertype that keeps `execute` callable, so an array of
mixed tools needs one. The safety is not lost, it moves: the loop runs `params.safeParse` before
`execute` is ever called, so `args` has been checked at runtime by the time a tool sees it.

`toOpenAITool` arrives a phase earlier than `plan.md` first scheduled it, for the drift reason
above. A hand-written JSON schema next to a Zod schema describing the same thing is two sources of
truth for the very first tool shrek has. Phase 2 moves this function into `registry.ts` and adds
dispatch around it.

`delete parameters.$schema` is not decoration. Zod emits
`"$schema": "https://json-schema.org/draft/2020-12/schema"` and some OpenRouter backends reject a
function schema carrying keys they do not recognise, with a 400 that never mentions `$schema`.

This also settles the open question at the end of Phase 0. `z.toJSONSchema` is built into Zod 4 and
you have 4.6.5 installed, so the separate `zod-to-json-schema` package is redundant. Leave it in
`package.json` until Phase 2, which is where tool schemas get a file of their own.

### 2. src/tools/bash.ts

**Why.** This is the only thing shrek can actually do today. Everything else in part a exists to
get arguments into it and text back out.

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

**stdout and stderr are the two streams a process writes to.** By convention the answer goes to
stdout and complaints go to stderr, which is how you can pipe a command's output into a file and
still see its errors on screen. shrek merges them because the model wants both.

**The exit code is a number a process leaves behind when it ends.** Zero means it worked, anything
else means it did not, and which number means what is up to the program.

Notice `Bun.spawn(['bash', '-c', command])` and not `Bun.$`. Bun ships its own cross-platform shell
implementation, which is excellent and is the wrong tool here. The model writes bash, sometimes
with `$(...)`, process substitution or a `source`, and it should be run by the bash the user has.

`timeout` and `killSignal` do the work the chapter's `subprocess.run(timeout=120)` does.
`signal: ctx.signal` is what makes ctrl-c during a ninety-second test run kill the test run rather
than orphan it.

The truncation marker matters. Silently cutting at 50,000 characters means the model reads a
partial file as a whole file and reasons confidently about content that was never there.

The blocklist is four lines of theatre and you should know it. `rm -rf ~` slips past it, and so
does `bash -c 'sudo rm -rf /'` once you look at the regex. It is in the chapter and worth copying
for the same reason the chapter has it. Phase 4 replaces it with a real allow, ask and deny policy.
Until then, run shrek in a directory you would not mind losing.

### 3. src/agent/events.ts

**Why.** This is the vocabulary the loop speaks. `bin/shrek.ts` turns these into lines today, Phase
3 turns the same ones into Ink components, Phase 5 into bus events.

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

This is a **discriminated union**, the same pattern as a Redux action type. Every member has a
`type` field with a literal value, so inside `if (event.type === 'turn.complete')` TypeScript knows
`event.answer` exists, and outside it knows it does not. You get an exhaustive switch and a compile
error when Phase 6 adds a case you forgot.

The `turn.step` members carry a `kind` because the real `TurnStepChunk` does the same, one event
name covering several shapes. Phase 6 adds `kind: 'delta'` for streaming and nothing gets renamed.

`turn.complete` fires on every ending, including aborted and error. A caller that handles only
`turn.complete` still behaves correctly in every case, which is why step 7 is as short as it is.

### 4. src/agent/systemPrompt.ts

**Why.** Without this the model does not know where it is, what day it is, or that it is meant to
act rather than explain.

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

The chapter's version is `f"You are a coding agent at {os.getcwd()}. Use bash to solve tasks. Act,
don't explain."` Three additions, each earning its line. The platform, because `ls -la` and `dir`
are different worlds and a model with no information guesses from its training data. The date,
because a model's knowledge ends on a fixed day and without one it reasons about "now" as if it
were then. And "no preamble", because a model that explains its plan before acting burns a round,
and rounds are what you pay for.

It is a function and not a constant because `cwd` is unknown until the process starts, and because
Phase 10 appends loaded skills to this string while Phase 12 appends memory.

### 5. src/agent/loop.ts

**Why.** This is the phase. Everything above is arguments and plumbing for these sixty lines.

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

Read it once for the shape. It is the chapter's `while True` with four things wrapped around it.

**`messages.push(message)` is the first thing that happens to a response.** Before the text is
read, before the calls are looked at, before anything can throw. That is round 5's rule made
structural.

**`prepare` returns a value on every path and `execute` is wrapped in a try.** So `output` is
always a string and the push of the `tool` message is unconditional. There is no arrangement of
failures that skips it. Rounds 6, 7 and 8 all end in the same three lines.

**`reason` is decided before the final yield, not at it.** A `break` with no assignment leaves it
`'answer'`, the good ending. Every other ending assigns first. The `step === maxSteps` check sits
at the bottom of the body, so it fires only when the round finished with tool calls still
outstanding, not when the model answered on the last permitted round.

**The tool loop is sequential.** Two calls in one message run one after the other. Phase 2 makes it
`Promise.all`, which is a three-line change and a page of discussion about tools writing to the
same file.

`max_tokens: 8000` matches the chapter and caps how much the model may say in one reply. If a model
starts truncating a long file it wrote, this is the number.

### 6. bin/shrek.ts

**Why.** The loop needs a way in. `-p` is how shrek runs headless, which is how every test from
here on is written and how Phase 9 runs a sub-agent.

The whole file, so paste over what Phase 0 left. Two imports are new and `createClient` joins a
third, `versionLines` is unchanged, and `main` gains the `-p` branch.

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

`console.error` for tool lines and `console.log` for the answer is the stdout and stderr split
again, and it is the difference between a command you can use in a script and one you cannot.

`process.on('SIGINT', ...)` catches ctrl-c and aborts rather than killing the process outright. The
signal reaches `Bun.spawn` through `ToolContext`, the running command dies, and the loop yields
`turn.abort` then `turn.complete` with `isAborted: true`. Without it, ctrl-c during a long command
leaves the command running.

`runPrint` returns an exit code rather than printing one, and `main` returns rather than exiting,
which is the shape Phase 0 set up. The single `process.exit` at the bottom of the file is unchanged.

### 7. Commit

```sh
bun run typecheck
git add -A
git diff --cached | grep -iE 'sk-or-|api[_-]?key'
git commit -m "phase 1a: agent loop"
```

The grep should match only `.env.example`. `learn/phase-1a.md` and `learn/ts/phase-1a.md` go in with
it: the stage documents and their TypeScript companions are part of this repo's record and get
committed with the phase they describe. `plan.md` stays ignored.

---

## Test

```sh
bun run bin/shrek.ts -p "how many .ts files are in this repo?"
```

Two kinds of line come out. The commands go to stderr as they run, and the answer goes to stdout at
the end:

```
$ find . -name '*.ts' -not -path './node_modules/*' | wc -l
There are 7 TypeScript files in this repo.
```

The exact command will differ every run, and so will the wording. What must be true: at least one
`$ ` line appeared, the number is right, and `echo $?` prints `0`.

Now prove the two streams really are separate, which is the thing that makes shrek usable in a
script:

```sh
bun run bin/shrek.ts -p "what is the current git branch?" > answer.txt
cat answer.txt
```

The `$ git branch --show-current` line still appears on your screen. `answer.txt` holds only the
answer.

### Watch a yield arrive

Round 9 rejected returning an array because the user would see nothing until the end. Here is the
difference, with a command slow enough to watch:

```sh
bun run bin/shrek.ts -p "run the command 'sleep 5 && echo hello' and tell me exactly what it printed"
```

The `$ sleep 5 && echo hello` line appears straight away. Then five seconds of nothing. Then the
answer. If instead both lines appear together after five seconds, values are not reaching `runPrint`
until the turn is over, which means something is collecting them rather than yielding them.

### Deliberate failure: a command that fails

```sh
bun run bin/shrek.ts -p "run the command 'definitelynotacommand --help' and tell me exactly what happened"
```

Correct behaviour is that shrek does not crash. You see the `$ ` line, and the answer says the
command was not found and mentions exit code 127. Round 7 is running.

- A stack trace ending in `bun run bin/shrek.ts` means something threw where it should have
  returned a string. The usual cause is missing the `try` around `execute`.
- An answer that invents plausible output for a command that never ran means the tool result never
  reached the model. Check that the `tool` message is being pushed.

### Deliberate failure: the iteration cap

Temporarily pass `maxSteps: 2` in `runPrint`, then ask for something that genuinely needs more:

```sh
bun run bin/shrek.ts -p "read every .ts file in src one at a time and summarise each"; echo "exit $?"
```

Correct failure:

```
shrek: turn ended with max_steps:
exit 1
```

- Exit 0 means `reason` was left as `'answer'`. The `step === maxSteps` line is in the wrong place,
  probably above the tool loop rather than below it.
- The process hanging means the cap is not in the `for` condition at all. Put `maxSteps` back to
  20 afterwards.

### Deliberate failure: no key

```sh
env -u OPENROUTER_API_KEY bun run bin/shrek.ts -p "hello"; echo "exit $?"
```

```
shrek: no OpenRouter key. Set OPENROUTER_API_KEY in .env, or "apiKey" in ~/.shrek/config.json
exit 1
```

That message comes from `createClient`, written in Phase 0 and called for the first time today. If
you instead get a 401 from OpenRouter, the `openai` package found a stale `OPENAI_API_KEY` in your
shell, which is the trap Phase 0 was designed to prevent. Check that `createClient` passes `apiKey`
explicitly.

---

## Notes and gotchas

**`Bun.$` is not bash.** It is Bun's own shell, written to behave the same on Windows. It does not
support process substitution, `source`, or shell functions, and it quotes interpolated values for
you. The model writes real bash, so run real bash with `Bun.spawn(['bash', '-c', command])`.

**`arguments` is a string and it can be empty.** Free models emit `''` or truncated JSON more often
than you would believe, usually when they are near their output limit. `JSON.parse(x || '{}')`
handles the empty case and the `try` handles the truncated one.

**One `tool` message per `tool_call_id`, always.** Not one per assistant message, not one per tool.
Per call id. And the array stays broken afterwards, so a run that hits this cannot be rescued by
retrying.

**Free models sometimes narrate instead of calling.** You will get `I'll run ls -la for you.` as
plain text with no `tool_calls`, and the loop correctly stops because there is nothing to run. That
is the model being weak, not your loop being wrong. Try one of the `FREE_FALLBACKS` ids from
`src/llm/models.ts`, or sharpen the "never describe a command you could simply run" line in the
system prompt.

**`response.choices` can be empty.** OpenRouter returns `{"choices": []}` when the upstream
provider errors in certain ways, and `noUncheckedIndexedAccess` in your `tsconfig.json` is what
forces you to notice. The `if (!message) throw` line is there for that, and it ends the turn with
`reason: 'error'` rather than a `Cannot read properties of undefined`.

**A `:free` model will rate-limit you during testing.** Running the test three times in a minute is
enough. You get a 429, the turn ends with `reason: 'error'`, and the answer text says so. Wait, or
switch with `SHREK_MODEL=...`, which is round 3 of Phase 0's worked example doing its job.

**`max_tokens: 8000` is a cap on the reply, not on the conversation.** Phase 11 deals with the
conversation growing past what the model can hold. If the model truncates a long command mid-word,
this number is the one to raise.

**The tool result is not pretty-printed on purpose.** What goes in the `tool` message is what the
command printed, unchanged. Any cleaning you do here is something the model cannot see, and models
are better at reading raw `git status` output than you expect.

---

## Recap

`src/tools/types.ts` and `src/tools/bash.ts` define what a tool is and provide the first one. A
tool is four fields and a Zod schema, and the schema is simultaneously the validator, the
TypeScript type and the JSON Schema the model reads, so the three cannot drift apart. `execute`
returns a string on every path including failure, which is the property the loop depends on.

`src/agent/events.ts` and `src/agent/loop.ts` are the loop. It appends a system and a user message,
then repeats: send the array, push the reply, run whatever tools the reply asked for, push one
`tool` message per call, go again. It stops when a reply has no tool calls, or after twenty rounds,
or when the signal aborts, and it says which of those happened. It yields events named after the
real engine's `turn.start`, `turn.step`, `turn.complete` and `turn.abort`, so Phase 5 can turn them
into a bus without renaming anything.

`bin/shrek.ts` turns those events into two output streams, commands on stderr and the answer on
stdout, and an exit code that is 0 only when the turn actually ended with an answer.

Three questions to check you got it.

1. The model asks for two commands in one reply and the first one's arguments will not parse. How
   many messages get appended to the array before the next request is sent, and what is in each?

2. `runAgent` yields events instead of printing. Name the two later phases that could not work if
   it printed, and say what each of them does with the same events instead.

3. A tool that throws and a network request that throws are handled differently. Which one becomes
   a `tool` message and which one ends the turn, and what goes wrong if you swap them?

---

Next: part b gives this loop a memory. Every message goes to an append-only file under
`~/.shrek/projects/`, the raw wire traffic goes to `~/.shrek/logs/shrek.log`, and `--debug` shows
you the second one while it happens.
