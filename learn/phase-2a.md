# Phase 2a: the registry and the file tools

About an hour. Most of it is typing five small files.

Phase 2 is two sittings. This is the first. Part a builds the tool registry and the three tools that
change files: Read, Write and Edit. Part b adds Glob and Grep, runs a batch of calls at once, and
writes the unit tests. Stop at the end of this file and commit.

---

## What we are building

Today you make this work:

```sh
shrek -p "add a docstring to the top of src/paths.ts"
```

shrek reads the file, works out where the top is, and writes the change back. No `cat`, no `sed`,
no shell at all.

### Where part a fits

After Phase 1 shrek has exactly one tool, Bash, and it is enough for anything in principle. To read
a file the model runs `cat src/paths.ts`. To write one it runs `echo "..." > src/paths.ts`. To
change one line it writes a `sed` expression and hopes.

That last one is where it falls apart. `sed -i '' 's/foo/bar/' file` is three different commands on
three different platforms, it silently does nothing when the pattern misses, and a slash or a
bracket in the replacement text breaks it. The model is not bad at `sed`. The problem is that
nothing tells it whether the edit landed.

Part a closes that gap. Read returns a file with line numbers, Write replaces one whole, and Edit
swaps an exact piece of text for another and refuses when it is not sure which piece you meant.
After this, shrek can change a codebase rather than only describe one.

Three things stay missing until part b: the model cannot find a file by pattern (Glob), cannot
search inside files (Grep), and runs its tool calls strictly one after another even when they have
nothing to do with each other.

### The files you are about to write

| File | In React terms | Its job |
|---|---|---|
| `src/tools/guards.ts` | a shared validator module | keep tools inside the project, cut long output |
| `src/tools/registry.ts` | your router's route table | hold the tools, describe them, run one by name |
| `src/tools/types.ts` | an edit, four lines | one new field on the context every tool receives |
| `src/agent/loop.ts` | an edit, eight lines | ask the registry instead of doing it itself |
| `bin/shrek.ts` | an edit, five lines | build the registry once at startup |
| `src/tools/bash.ts` | an edit, one description | stop steering the model to the shell for files |
| `src/tools/read.ts` | nothing in React, it is new | return a file with line numbers |
| `src/tools/write.ts` | nothing in React, it is new | replace a file whole, creating folders |
| `src/tools/edit.ts` | nothing in React, it is new | swap one exact piece of text for another |

> **New to TypeScript?** [`learn/ts/phase-2a.md`](./ts/phase-2a.md) explains every TypeScript
> construct this phase uses, in the order it appears, using these same pieces of code. The code
> blocks below link into it. You do not need it to finish the phase; it is there for when a line of
> syntax is in the way of the idea.

---

## What you'll learn

- **A tool's description is an API, and so are its errors.** The model reads that text and nothing
  else. You will write a vague description on purpose, watch a real model misuse the tool, then
  rewrite it and read the two transcripts side by side.
- **Refusing is more useful than guessing.** Edit stops when the text it was given appears twice.
  The chapter's version silently changes the first one, which is the kind of bug you find a week
  later in a file you were not looking at.
- **A failed tool is a normal result.** Every error in this phase travels back to the model as an
  ordinary tool message, and one `try` in one function is what guarantees it.
- **Adding a tool is one file and one word.** After step 3 nothing in the loop knows how many tools
  exist, which is why steps 4, 5 and 6 are each a single file.

---

## From the course

The source chapter is `../learn-claude-code/s02_tool_use/`. Read `code.py`, all 196 lines, and note
how little of it is new. The agent loop is copied from s01 with one line changed.

Its structure, in three pieces:

- Five `run_*` functions: `run_bash` from s01, then `run_read`, `run_write`, `run_edit` and
  `run_glob`.
- `safe_path(p)`, which resolves a path and raises if it lands outside the working directory.
- Two module-level tables and the one changed line:

```python
TOOL_HANDLERS = {
    "bash": run_bash, "read_file": run_read, "write_file": run_write,
    "edit_file": run_edit, "glob": run_glob,
}

# s01: output = run_bash(block.input["command"])
# s02: output = TOOL_HANDLERS[block.name](**block.input)
```

That comment is the chapter's whole thesis, and it is correct. A dispatch table turns "add a tool"
from an edit to the loop into an edit to a table. shrek keeps the idea and changes three things.

**The table becomes an object with methods.** `TOOL_HANDLERS` is a dict, and the loop reaches into
it. shrek's `createRegistry` returns an object with `list`, `toOpenAITools`, `renderCall` and
`dispatch`, and the loop calls those. The reason is Phase 5. That phase introduces `$`, the engine
object every extension hooks into, and `$.tool` is one of its nouns. A dict has nothing to hook. An
object with four named methods is already the right shape.

**Dispatch validates.** `handler(**block.input)` unpacks whatever the model sent straight into
Python function arguments. Send `{"path": 5}` and you get a `TypeError` from inside `read_text`,
which is an exception in the middle of the loop. shrek runs the arguments through the tool's Zod
schema first and turns a failure into a message for the model. Phase 1a made this decision for one
tool; five tools is where it earns its keep.

**Edit refuses an ambiguous match.** Here is the chapter's:

```python
def run_edit(path: str, old_text: str, new_text: str) -> str:
    text = file_path.read_text(encoding="utf-8")
    if old_text not in text:
        return f"Error: text not found in {path}"
    file_path.write_text(text.replace(old_text, new_text, 1), encoding="utf-8")
    return f"Edited {path}"
```

The `1` in `replace(old_text, new_text, 1)` means "the first one". If `old_text` appears three
times, two are left alone and the tool reports success. The model believes it, moves on, and the
file is now inconsistent in a way nobody looked at. shrek counts the matches first and returns an
error naming the count when it is more than one. Round 3 of the worked example is that exact file.

### The names to steal

The standards reference is `../claude-code/mods/types/claude-code.d.ts`. Three declarations in it
decide how this phase is built.

The first is what the real engine asks for when a plugin registers a tool:

```ts
/**
 * What `$.tool.register` takes.
 */
export type ToolSpec = {
    name: string;
    description: string;
    inputSchema?: Record<string, unknown>;
};
```

Three fields, and your `toOpenAITools()` produces exactly them: a name, a description, and a JSON
schema generated from Zod. Take the rule that a tool as the model sees it is only those three
things. Your `execute` and your `renderLine` are shrek's private business and never leave the
process.

The second is what the engine hands back when something asks what tools exist:

```ts
/**
 * One tool as `$.tool.list()` returns it.
 */
export type ToolInfo = {
    name: string;
    description: string;
    mcp: boolean;
};
```

Read that as a statement about the model's situation. The entire catalogue of what an agent can do
is a list of names and a paragraph each. There is no documentation, no examples, no type
signatures, nothing to click. Take the rule that the description carries the full weight of
explaining the tool, because nothing else is there to carry any of it. That rule is what the worked
example is about.

The third is what a finished tool call looks like:

```ts
export type ToolCallResult<Name extends string = string> = {
    deny: string;
    ...
} | {
    result: ToolResultOf<Name>;
    ...
    /**
     * Present only when the tool reported an error, as on `tool.call`'s result.
     */
    isError?: true;
};
```

An error is a **field on a result**, not a thrown exception and not a missing value. The engine
built by people running this in production models a tool failure as data. That is the same
conclusion Phase 1a reached from the OpenAI message rules, arrived at from the other direction, and
it is why your `dispatch` returns `{ output, isError }` and never throws. `deny` is the other
branch; Phase 4 fills it in when you add permissions.

---

## Anthropic to OpenAI translation

One row of the standing table matters today, and it is the one that looked harmless in Phase 1.

| The course (Anthropic) | shrek (OpenRouter, OpenAI shape) |
|---|---|
| `block.input`, already a parsed object | `tool_call.function.arguments`, a **string** of JSON you must parse yourself |

With one tool and one parameter, a bad `arguments` string was rare. With five tools and up to four
parameters each, it is a daily event. The free models in Phase 0's registry produce all of these:

```jsonc
{"file_path": 5}                          // right key, wrong type
{"path": "src/a.ts"}                       // the chapter's key name, not yours
{"file_path": "src/a.ts", "old": "x"}      // a parameter it invented
{"file_path": "src/a.ts", "content": nul   // cut off at the output limit
```

Only the last one is a JSON error. The other three parse perfectly into objects that are wrong, and
without a schema check they reach your code and throw from somewhere deep, like `read_text` in the
chapter. Zod catches all three at the door and turns each into a sentence the model can act on.

**The failure part a will hit.** Not a crash. An Edit that reports success and changes nothing, or
changes the wrong one of three identical lines. It is quiet, the model believes the success message,
and you find it when the file no longer runs. Rounds 2 and 3 of the worked example are the two
shapes it takes.

---

## Background

**A description is an API, and you are writing it for one reader.** The model decides which tool to
call, and with what, from the name and the description string. That is all it has. So the
description is not documentation about the tool, it is the tool's interface, and the things it must
say are the things a caller cannot work out alone: what the tool is for, when to prefer it over a
neighbour, what the parameters mean exactly, and what the caller has to have done first. "Edit a
file." says none of those. A caller reading it has to guess whether `old_string` is a line number, a
regular expression, a whole function, or a fragment. It will guess, and it will guess differently
on different days.

**Error messages are the same API, at the moment it matters most.** When a tool succeeds the model
moves on. When it fails, the error string is the only information it gets about how to try again.
Compare `Error: text not found` with `Error: old_string was not found in src/a.ts. It must match the
file exactly, including indentation. Read src/a.ts again and copy the text from it.` Both are true.
The first leaves the model to invent a next step, and what it invents is usually the same call
again. The second names the recovery. Write every error as an instruction to somebody who cannot
see your code.

**Read before edit is a protocol, not a safety check.** shrek refuses an Edit to a file that has not
been read in this conversation. It is not about permissions; Phase 4 does permissions. It is about
the fact that `old_string` has to match the file byte for byte, and a model that has not read the
file is remembering it, or guessing from the name. A remembered file is usually right about the
words and wrong about the whitespace, which produces an edit that fails for reasons nobody can see.
Forcing the Read makes the exact text sit in the conversation immediately above the call that uses
it, which is the condition under which models copy strings accurately.

**Why exact string matching beats the alternatives.** Two other designs are obvious. Edit by line
number, `{ file: "a.ts", line: 12, text: "..." }`, is precise and breaks the moment an earlier edit
shifts the file, so a batch of edits applied top to bottom corrupts everything after the first. Edit
by unified diff, the `@@ -12,7 +12,9 @@` format, is what a human would send, and it makes the model
produce both correct context lines and correct line counts, which small models cannot do reliably.
Exact string match has one failure mode, the string does not appear, and that failure is detectable
before anything is written. A tool whose failures are all detectable is worth a lot more than a tool
that is elegant.

**Why the path guard is its own file.** `resolveInside` refuses a path that resolves outside the
project. Read, Write, Edit, Glob and Grep all need it, and in the chapter it is one function that
every file tool calls. Keep that. The value is not the four lines of code, it is that the rule lives
in one place, so Phase 4 can tighten it and five tools tighten with it. Note what it does not do:
Bash has no such guard and can still `cd /` and do as it likes. The guard is a guard rail, not a
sandbox, and pretending otherwise is how you end up trusting it.

---

## Worked example

Before any code, read a tool description the way a model reads it, which is with no access to the
code underneath.

### Round 1: what the model sees

This is the entire Edit tool, as it arrives in a request, if the description is `Edit a file.`:

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

The task is "rename the function `slugifyCwd` to `slugify` in src/paths.ts". Write down the call you
would make, knowing only the above.

<details><summary>Predict, then open</summary>

Every one of these is a reasonable reading, and models produce all of them:

```jsonc
{"file_path": "src/paths.ts", "old_string": "slugifyCwd", "new_string": "slugify"}
{"file_path": "src/paths.ts", "old_string": "27", "new_string": "export function slugify(cwd: string): string {"}
{"file_path": "src/paths.ts", "old_string": "export function slugifyCwd", "new_string": "export function slugify"}
{"file_path": "src/paths.ts", "old_string": "<the whole file>", "new_string": "<the whole file, edited>"}
```

Nothing in the schema rules any of them out. `old_string` is a string, and a line number is a
string. The second one is not the model being stupid, it is the model using the line numbers your
Read tool printed, because you gave it those and then said nothing about whether they are part of
the file.

Now the first one. `slugifyCwd` appears three times in `src/paths.ts`: the definition and two call
sites. Under the chapter's `replace(old, new, 1)` this renames the definition and leaves both calls
pointing at a function that no longer exists. Under shrek's rule it is refused with a count.
</details>

### Round 2: the same call, with a description that does its job

```
Replace an exact piece of text in a file with different text.

old_string must match the file byte for byte, including indentation and
newlines. Copy it from a Read of this file, and never include the line
numbers that Read prints. old_string must appear exactly once in the file,
so include enough surrounding lines to make it unique; if you want every
occurrence changed instead, pass replace_all: true.

You must Read a file before you Edit it.
```

Which of the four calls survive?

<details><summary>Predict, then open</summary>

Only the third, `"export function slugifyCwd"`, and it survives because the description asked for
enough context to be unique.

Line numbers are ruled out by one clause. The bare `"slugifyCwd"` is ruled out by "exactly once",
and the description even names the fix. The whole-file rewrite is now obviously the wrong tool; the
word "exact" and the phrase "surrounding lines" both say this is for a fragment.

Count the sentences that did the work. Four. Everything else in that description is context. This
is the highest-value writing in the whole project, and it costs about 90 tokens per request.
</details>

### Round 3: the silent corruption

`src/tools/guards.ts` has not been written yet, so use this file instead. Three lines, and the
model calls `Edit(file_path: "notes.txt", old_string: "TODO", new_string: "DONE")`.

```
TODO write the tests
TODO check the mtime sort
ship it
```

Predict the file under the chapter's rule, then under shrek's.

<details><summary>Predict, then open</summary>

The chapter writes the file back as:

```
DONE write the tests
TODO check the mtime sort
ship it
```

and returns `Edited notes.txt`. The model has been told the edit succeeded, and it did, for a third
of the file.

shrek counts first, finds 2, writes nothing and returns:

```
Error: old_string appears 2 times in notes.txt. Add more surrounding lines to make it unique, or
pass replace_all: true to change all 2.
```

The model's next call is either `old_string: "TODO write the tests"` or the same call with
`replace_all: true`, and both are right. That recovery is free. You get it by counting before you
write and by putting the count and both options in the error string.

Counting also decides the shape of the code. `text.split(old_string).length - 1` gives you the
count, and the same `split` gives you the replacement, which keeps you away from `String.replace`:

```ts
'a-a-a'.replace('a', 'X')        // 'X-a-a'  only the first, always
'cost: $5'.replace('$5', '$&9')  // 'cost: $59'  $& is a substitution token
```

A string first argument replaces one occurrence and there is no flag to change that, and the
replacement string has its own syntax on top. Use `split(old).join(new)`, or slice around an index.
</details>

### Round 4: four error strings

The model calls Edit on a file it has never read. Rank these four replies by how likely the next
call is to succeed.

```
A  Error: not read
B  Error: file not read
C  Error: you must read a file before editing it
D  Error: you have not read src/paths.ts in this conversation. Call Read on it first, then Edit it.
```

<details><summary>Predict, then open</summary>

D, then C, then B and A together at the bottom.

A and B state a fact about the world with no verb for the model to act on, and they do not name the
file, which matters when the model has three edits in flight and needs to know which one to fix.

C names the action, and it is most of the way there. It fails on the specific: the model has read
*a* file, maybe two, and "a file" leaves it to guess which one you meant.

D names the file, names the action, and names the order. It is one sentence longer than C and it is
the only one that works when the conversation is busy.

The general rule to take from this: an error message should contain the subject (which file), the
problem (not read), and the next call to make (Read, then Edit). Three parts. Check every error
string you write today against them.
</details>

### Round 5: where the try goes

Read calls `resolveInside`, which throws when the path escapes the project. Four places could catch
that throw. Predict which one, and what the other three cost.

1. Inside `resolveInside`, returning a string instead of throwing.
2. Inside each tool's `execute`, wrapped around its own body.
3. Inside `dispatch`, wrapped around the `execute` call.
4. Nowhere. Let it reach `runAgent`'s existing `catch`.

<details><summary>Predict, then open</summary>

Three.

Option 4 is the Phase 1a bug in a new costume. The throw escapes between the assistant message going
into the array and its tool result going in, so the array holds a call with no answer, and part b
already saved that array to disk. Every retry re-sends it and gets the same 400.

Option 2 works and you write it five times, then six in part b, and Phase 8 adds a seventh. Every
tool needs the same four lines, and the one you forget is the one that breaks the array.

Option 1 means `resolveInside` returns `string | { error: string }` and every caller unpacks it
before it can use the path. That is five unpackings to avoid one `try`, and the guard can no longer
be used in a place where an escape really is a bug.

Option 3 is one `try`, in the one function that every tool call already passes through, positioned
where a throw can still become a tool result. It also covers the errors you did not think of:
`ENOSPC` from a full disk, a permissions error on a read-only file, and whatever Phase 8's tool does
wrong. The rule from Phase 1a stands unchanged, and now it lives in one place: a tool's own failure
is data, a failure of the machinery around tools is an exception, and `dispatch` is the line between
them.
</details>

---

## Your task

Eight steps. In a second terminal, start `bunx tsc --noEmit --watch` and leave it running.

### 1. src/tools/guards.ts

**Why.** Every file tool needs the same two rules, and Phase 4 tightens the first one in a single
place rather than in six.

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

`resolve` is what does the real work. It collapses `..` and `.` and makes the path absolute, so
`resolveInside('/Users/youruser/repo/your-agent', '../../.ssh/id_rsa')` produces
`/Users/youruser/.ssh` and fails the prefix check.

The `full !== root` before the `startsWith` is the bug you would otherwise write. Without it,
reading the project directory itself fails, because `/a/b` does not start with `/a/b/`. And the
`+ sep` is the other half: plain `startsWith(root)` accepts `/Users/youruser/repo/your-agent-secrets`,
which is a different project.

This is a guard rail and not a sandbox. A symlink inside the project pointing out of it passes,
because `resolve` does not follow links. Bash ignores the whole thing. Say what it is for out loud:
it stops a confused model from wandering, not a hostile one from trying.

### 2. src/tools/registry.ts, and four lines out of types.ts

**Why.** This is the file that lets steps 4, 5 and 6 each be one new file with no other edit
anywhere. It is also the thing Phase 5 turns into `$.tool`.

First the edit to `src/tools/types.ts`. The `toOpenAITool` function and its
`ChatCompletionFunctionTool` import move into the registry, and `ToolContext` gains one field.
Replace the whole file with this:

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

Now the registry.

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

Most of `dispatch` is the `prepare` function you wrote in Phase 1a, moved here and given the `try`
from round 5. Delete `prepare` from `loop.ts` in the next step.

The four early returns are in the order the failures happen, and each one names what the model can
do next. `no tool named X. Available: ...` is the important one: a model that invented `read_file`
because it saw the chapter gets the real list back and calls `Read` on the next round.

`renderCall` parses the arguments a second time, which is real duplicated work and the right trade.
The alternative is `dispatch` taking an `onStart` callback so it can report the line before it runs,
which puts display concerns inside the function that does the work.

`schemas` is computed once, at `createRegistry`, not per request. Phase 1a rebuilt it on every
`runAgent` call, which with five tools and twenty rounds is a hundred conversions per question.

`list()` has no caller today. It is here because `ToolInfo` in the standards file is what
`$.tool.list()` returns, Phase 5 wires that up, and Phase 10 builds the skill catalogue the same
way. If you want the rule enforced: a tool's public face is `{ name, description }` and nothing
else, and `list` is where that is written down.

### 3. src/agent/loop.ts and bin/shrek.ts, the wiring

**Why.** Once this step is done, the loop no longer knows how many tools exist, so steps 4, 5 and 6
each touch exactly one new file and one word of `bin/shrek.ts`. That claim is the chapter's thesis
and this is where you make it true.

In `src/agent/loop.ts`, delete the `prepare` function and the `Prepared` type, replace the whole
import block at the top of the file with this one, and change the options:

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

Near the top of the function body, replace the two `byName` and `schemas` lines with:

```ts
  const schemas = opts.registry.toOpenAITools()
  const ctx: ToolContext = { cwd, signal, readFiles: new Set() }
```

and replace the whole body of the `for (const call of calls)` loop with four lines:

```ts
      for (const call of calls) {
        const { name, line } = opts.registry.renderCall(call)
        yield { type: 'turn.step', turnId, step, kind: 'tool', id: call.id, name, line }

        const result = await opts.registry.dispatch(call, ctx)
        await add({ role: 'tool', tool_call_id: result.id, content: result.output })
        yield { type: 'turn.step', turnId, step, kind: 'result', id: result.id, output: result.output }
      }
```

The `yield` of the display line still happens before the tool runs, so a slow Read is on screen
while it is slow. Part b keeps that property when the calls go parallel.

`ctx` is built once, outside the step loop, and that is the whole read-before-edit mechanism.
`readFiles` accumulates for the life of one `runAgent` call and dies with it. A second `shrek -p`
starts with an empty set, and Phase 9's sub-agents each get their own, which is correct: a file the
parent read is not a file the child has seen.

Now `bin/shrek.ts`. Add the imports and build the registry above `main`:

```ts
import { createRegistry } from '../src/tools/registry'
import { bash } from '../src/tools/bash'
import { read } from '../src/tools/read'
import { write } from '../src/tools/write'
import { edit } from '../src/tools/edit'

const registry = createRegistry([bash, read, write, edit])
```

and in `runPrint`, swap one line:

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

Finally, tell the model the tools exist. In `src/agent/systemPrompt.ts`, replace the Bash paragraph:

```ts
    'Use the tools to find things out. Never guess about the contents of this machine',
    'and never describe a change you could simply make.',
    '',
    'Prefer the file tools over the shell: Read instead of cat, Write instead of a redirect,',
    'Edit instead of sed. Use Bash for everything else, such as running builds and tests.',
```

That is not enough on its own. Bash's description from Phase 1 still tells the model to use it to
"read or change files", and a tool's own description outweighs a sentence in the system prompt,
because it sits right next to the tool the model is choosing. Leave it and the model will notice
Edit exists, then `cat` and `sed` the file anyway, because Bash said it could. In
`src/tools/bash.ts`, replace the `description`:

```ts
  description:
    'Run a shell command in the project directory and return its combined stdout and stderr. ' +
    'Use this to run builds, tests, git and other programs. Do not use it to read, create or ' +
    'change files: use Read, Write and Edit for those. ' +
    'The exit code is appended when it is not zero. Commands time out after 120 seconds.',
```

Adding a tool can make an old description wrong. Each time you add one, reread the descriptions of
the tools it overlaps with.

The three imports in `bin/shrek.ts` refer to files that do not exist yet, so the type checker is red
until step 6. That is expected, and it is the last time in this phase that a step leaves it red.

### 4. src/tools/read.ts

**Why.** Without this the model reads files by running `cat`, which cannot page through a long file
and gives it no line numbers to talk about. Edit in step 6 also refuses to touch a file this tool has
not seen.

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

`ctx.readFiles.add(path)` stores the **resolved** absolute path, not `file_path`. The model will
Read `./src/paths.ts` and Edit `src/paths.ts`, and those are the same file. Storing the string it
sent would make the gate fire on a difference that does not exist.

The numbering format is `cat -n`: six right-aligned columns, a tab, the line. Copy it exactly. It is
what real Claude Code emits, which means models have seen a great deal of it, and the tab is the
part that matters. A tab is a clear boundary between the number and the content, which is what lets
the model tell them apart when it copies a fragment for an Edit.

Three different errors for three different situations, each naming the tool to reach for next. The
lazy version of all three is `Error: cannot read file`, and every one of them would then cost the
model a round of guessing.

`stat` first, contents second. It means a 900MB file is refused without being loaded into memory,
which is the difference between an error message and shrek being killed by the operating system.

### 5. src/tools/write.ts

**Why.** Without this the model creates files with `echo` and a redirect, which mangles quotes,
backslashes and anything with a `$` in it. Part b's fizzbuzz test is a Write followed by a Bash.

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

`Bun.write` truncates the file it opens, which is exactly the bug part b of Phase 1 made you produce
on purpose in the transcript writer. Here that behaviour is the whole point. Same function, opposite
verdict, and the difference is what the file is for.

The result says `Replaced` or `Created`. The model asked for one thing and those are two different
outcomes, and a model that has just silently replaced 400 lines of somebody's code should be told.
The description leans the same way, with a sentence steering it to Edit for files it did not write.

`mkdir` with `recursive: true` is `mkdir -p`. It succeeds when the folder already exists, so there
is no need to check first.

`ctx.readFiles.add(path)` here as well as in Read, because writing a file is a stronger claim to
know its contents than reading it. Without this line, a Write followed by an Edit of the same file
is refused, which happens constantly.

### 6. src/tools/edit.ts, with a bad description on purpose

**Why.** This is the tool that changes existing code, which is most of what a coding agent does.

Type it exactly as written, including the description. The description is wrong on purpose and you
fix it in step 7.

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

Every check runs before anything is written, and there are four of them. `min(1)` on `old_string` is
the fifth, done by Zod: an empty string makes `split('')` return every character, so `count` would
be the length of the file.

`text.indexOf(old_string)` is computed once and used for both the splice and the preview, and it is
correct for `replace_all` too, because everything before the first match is identical in the old text
and the new.

The preview costs eight lines and buys a specific thing: the model sees its own change in context,
with line numbers, and catches a wrong indentation immediately rather than three rounds later when
the build fails.

Now the type checker should be green for the first time since step 3. Run it and commit nothing yet.

```sh
bun run typecheck
```

### 7. Watch the description fail, then fix it

**Why.** This is the point of the phase. You are about to read the same model, given the same task,
behave completely differently because of one paragraph.

Make a file for the model to work on. This is deliberately awkward: the word appears three times.

```sh
cat > notes.txt <<'EOF'
TODO write the tests
TODO check the mtime sort
ship it
EOF
```

Run the vague version:

```sh
bun run bin/shrek.ts -p "in notes.txt, change the first TODO to DONE and leave the others alone"
```

Watch the `Edit(notes.txt)` lines go past on stderr. You will see one of these, and which one
depends on the model and the day:

- An Edit before any Read, refused by the gate.
- `old_string: "TODO"`, refused with the count of 2.
- `old_string: "     1\tTODO write the tests"`, with the line number copied out of Read's output,
  refused with "not found".
- `replace_all: true`, which changes both and is the opposite of what was asked.

Any of those is the result you want. The model is not confused about the task, it is confused about
the tool, and every one of those calls is a sensible reading of `Edit a file.`

Now fix the description. Replace the `description` line and add `.describe()` to all four
parameters:

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

Restore the fixture and run the identical prompt again:

```sh
cat > notes.txt <<'EOF'
TODO write the tests
TODO check the mtime sort
ship it
EOF

bun run bin/shrek.ts -p "in notes.txt, change the first TODO to DONE and leave the others alone"
```

Now read the two runs side by side. Both transcripts are on disk from Phase 1b:

```sh
D=~/.shrek/projects/$(printf '%s' "$PWD" | tr -cs 'A-Za-z0-9' '-')
GOOD=$(ls -t "$D"/*.jsonl | sed -n 1p)
VAGUE=$(ls -t "$D"/*.jsonl | sed -n 2p)

calls() { jq -r 'select(.message.tool_calls) | .message.tool_calls[] | .function.name + " " + .function.arguments' "$1"; }
diff -y --width=160 <(calls "$VAGUE") <(calls "$GOOD")
```

The left column is longer than the right. That difference is the whole lesson, and it is worth
counting: every extra line on the left is a wasted request, paid for in tokens and in seconds.

Then read the errors the vague run collected:

```sh
jq -r 'select(.message.role == "tool") | .message.content' "$VAGUE" | grep '^Error:'
```

Each of those errors did its job, because the model recovered eventually. That is the argument for
spending as much care on the error strings as on the description: the description prevents the
mistake, and the error is what limits the damage when the description was not enough.

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

Set up a fixture, then work it by hand. The prompts are written so that one tool answers each.

```sh
mkdir -p /tmp/shrek-fixture/src
printf 'const x = 1\nconst y = 1\n' > /tmp/shrek-fixture/src/a.ts
cd /tmp/shrek-fixture
```

Every command below runs from the fixture, not from your project. Bun reads `.env` from the
directory you are standing in, so from here it never finds your key and shrek stops with
`no OpenRouter key`. Put the key where shrek looks no matter the directory, in
`~/.shrek/config.json`:

```json
{ "apiKey": "sk-or-..." }
```

If that file already exists, add the `apiKey` field to it rather than replacing the file. A
one-off `export OPENROUTER_API_KEY=sk-or-...` in this terminal works too, and so does
`bun --env-file=/Users/youruser/repo/your-agent/.env run ...`, but the config file is the one that
keeps working for every fixture in later phases.

### Read

```sh
bun run /Users/youruser/repo/your-agent/bin/shrek.ts -p "show me src/a.ts"
```

Substitute your own project path in that command. On stderr you should see exactly one tool line:

```
Read(src/a.ts)
```

and the answer should contain both lines of the file. If you see `$ cat src/a.ts` instead, the model
chose Bash, which means one of step 3's two prompt edits did not land: the system prompt, or the
Bash description that still says it reads and changes files.

### Edit refuses an ambiguous match

```sh
bun run /Users/youruser/repo/your-agent/bin/shrek.ts -p "in src/a.ts change const to let on the first line only"
```

With step 7's description in place, the model will often send `old_string: "const x = 1"` on its
first Edit, because the description told it to include enough to be unique. If it sends a bare
`"const"` instead, one tool result is:

```
Error: old_string appears 2 times in src/a.ts. Add more surrounding lines to make it unique, or pass replace_all: true to change all 2.
```

and the model reads that and sends `const x = 1` next. Either path is correct, and seeing the error
or not depends on the model and the day. You may also see a Bash call such as
`head -1 src/a.ts | od -c` before the Edit; that is the model checking the exact bytes, because
Read cannot show a tab from spaces. What must hold either way is the file. Check it:

```sh
cat src/a.ts
```

```
let x = 1
const y = 1
```

- If both lines changed, `replace_all` is being read as true when it was not sent, or you used
  `split().join()` on the single-match path.
- If nothing changed and the run ended anyway, the error string is not reaching the model. Check
  that `execute` returns it rather than throwing it.

### The read-before-edit gate

The gate is hard to trigger from a prompt, because the model reads files. Trigger it directly:

```sh
cd /Users/youruser/repo/your-agent
bun -e '
  const { edit } = await import("./src/tools/edit")
  const ctx = { cwd: "/tmp/shrek-fixture", signal: new AbortController().signal, readFiles: new Set() }
  console.log(await edit.execute({ file_path: "src/a.ts", old_string: "const x", new_string: "let x" }, ctx))
'
```

```
Error: you have not read src/a.ts in this conversation. Call Read on it first, then Edit it.
```

### The path guard

```sh
bun -e '
  const { resolveInside } = await import("./src/tools/guards")
  for (const p of ["src/a.ts", "../secrets.txt", "/etc/passwd", "."]) {
    try { console.log(p, "->", resolveInside("/tmp/shrek-fixture", p)) }
    catch (e) { console.log(p, "->", e.message) }
  }
'
```

```
src/a.ts -> /tmp/shrek-fixture/src/a.ts
../secrets.txt -> path escapes the workspace: ../secrets.txt
/etc/passwd -> path escapes the workspace: /etc/passwd
. -> /tmp/shrek-fixture
```

- If the last line throws, the `full !== root` check is missing.

### Deliberate failure: let a tool throw

This is the one from round 5, and it is worth doing because the damage is invisible at the time.
Comment out the `try` and `catch` in `dispatch`, leaving the `return` inside:

```ts
      return { id: call.id, output: await tool.execute(parsed.data, ctx), isError: false }
```

Then run a prompt that makes a tool throw, which a path escape does:

```sh
bun run bin/shrek.ts -p "read ../../etc/passwd"; echo "exit $?"
```

Expect `shrek: turn ended with error: path escapes the workspace: ../../etc/passwd` and `exit 1`.
Now look at what it left behind:

```sh
D=~/.shrek/projects/$(printf '%s' "$PWD" | tr -cs 'A-Za-z0-9' '-')
F=$(ls -t "$D"/*.jsonl | head -1)
jq -r 'select(.message.tool_calls) | .message.tool_calls[].id' "$F"
jq -r 'select(.message.role == "tool") | .message.tool_call_id' "$F"
```

The first command prints an id. The second prints nothing. That transcript holds a question with no
answer, it is saved to disk, and Phase 7 will resume it straight into a 400 that no retry can fix.

Put the `try` back and run the same prompt:

```sh
bun run bin/shrek.ts -p "read ../../etc/passwd"; echo "exit $?"
```

Now the model gets `Error: path escapes the workspace: ../../etc/passwd`, tells you it cannot read
outside the project, and the run ends with `exit 0`. Re-run the two `jq` commands: two lists, same
id. That is the difference one `try` makes, and it is the reason it lives in `dispatch` rather than
in any tool.

---

## Notes and gotchas

**`String.replace` with a string argument is a trap twice over.** It replaces one occurrence with
no flag to change that, and the replacement string has its own syntax where `$&`, `$1` and `` $` ``
are substitution tokens. `'cost: $5'.replace('$5', '$&9')` produces `cost: $59`. Models write `$`
constantly, in shell snippets and prices and template literals, and the failure is silent. Slice
around an index, or `split(old).join(new)`.

**`z.toJSONSchema` needs Zod 4.** It is built in, which is why `zod-to-json-schema` is not imported
anywhere despite being in `package.json` from Phase 0. You can remove that dependency; nothing uses
it.

**`delete parameters.$schema` is not optional.** Zod emits a `$schema` key naming the JSON Schema
draft. Some providers pass the whole object to a strict validator and reject the request because of
it, with an error that does not mention `$schema`. One line, deleted once, in the registry.

**Tool names are case-sensitive and models guess the chapter's.** `Read` and `read_file` are
different tools as far as the model is concerned. The `Available: ...` list in the unknown-tool error
is what recovers from it, and it is why that error lists the names rather than just saying no.

**`relative(cwd, path)` for display, absolute for keys.** Errors that print
`/Users/youruser/repo/your-agent/src/a.ts` waste tokens and read badly. `readFiles` must hold the
absolute path, because it is a key. Getting these two the wrong way round produces a gate that fires
at random.

**The `.describe()` strings are not comments.** They go into the JSON schema and reach the model,
and they are where per-parameter rules belong. The description says what the tool is for, and the
`.describe()` says what each argument means. Both are sent, both are read, and splitting them this
way keeps either one from becoming a wall of text.

**A tab in the Read output, not spaces.** `String(n).padStart(6)` then a tab. Spaces on both sides of
the number makes it ambiguous where the number stops, and models then include part of it in
`old_string`.

**`Set` membership is by identity for objects and by value for strings.** `readFiles` holds strings,
so `has()` does what you expect. If you ever store objects in a `Set`, two identical objects are two
members.

**`/tmp` is a symlink to `/private/tmp` on macOS.** If you use `/tmp` paths in a `cwd` and compare
against a resolved path, they will not match. This costs part b's test file an hour if you do not
know it; use `mkdtemp` and the path it returns.

---

## Recap

`src/tools/guards.ts` holds the two rules every file tool shares: a path must resolve inside the
project, and output has a cap with a note saying how much was cut. It throws rather than returning an
error value, because exactly one place catches it.

`src/tools/registry.ts` holds the tools and is the only thing that knows how many there are. It
builds the OpenAI schemas once, produces the display line for a call before the call runs, and
dispatches a call through four validation steps and one `try`, returning `{ id, output, isError }` on
every path. It never throws, which is what keeps the message array sendable.

`read.ts`, `write.ts` and `edit.ts` are one file each and nothing else changed to add them. Read
numbers the lines and records what it has seen; Write replaces a file whole and says whether it
created or replaced it; Edit swaps one exact string, refuses when the string appears zero times or
more than once, refuses a file that has not been read, and shows the changed region back.

The loop lost its `prepare` function and gained a `ToolContext` that lives for the whole run. It
still contains no tool names.

Three questions to check you got it.

1. `dispatch` never throws, and `resolveInside` always throws. Both are deliberate. Give the rule
   that decides which one a new function should be, and apply it to a Write that runs out of disk
   space.

2. Edit refuses when `old_string` appears twice, and the chapter's version edits the first match.
   Name a task where the chapter's behaviour is more convenient, and say why shrek still refuses.

3. `renderCall` parses the model's arguments, then `dispatch` parses the same string again a moment
   later. Explain what that duplication is buying, and what the alternative would have cost.

---

Part a is done. shrek can read, write and edit files, and the description you wrote in step 7 is the
reason it does it correctly. Part b adds Glob and Grep so it can find the file in the first place,
runs a batch of calls at the same time instead of one after another, and puts the whole set under
`bun test`.
