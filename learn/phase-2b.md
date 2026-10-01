# Phase 2b: search, parallel calls and tests

About an hour. Two tools, one loop edit, and a test file.

This is the second half of Phase 2. Part a left you with a registry and three tools: Read, Write and
Edit. The model can change any file you name for it. It cannot find a file it has not been told
about, it cannot search inside files at all, and it runs its tool calls strictly one after another.

---

## What we are building

Today you make this work:

```sh
shrek -p "which files mention slugifyCwd, and what do they do with it?"
```

shrek greps the project, gets three paths back, reads all three at once, and answers. No file names
from you.

### Where part b fits

Search is the difference between an agent that edits files and an agent that works on a codebase.
Without it the model's only way to find anything is `ls` and `cat` through Bash, one directory at a
time, pasting whole files into the conversation to look at four lines of them.

Glob answers "where is the file called something like this". Grep answers "where is this text".
Between them they are how every real coding agent starts a task, and both exist because doing it
through Bash is slow in tokens rather than impossible.

The third piece is speed. When the model asks for three files, part a reads them one after another,
and each one waits for the last to finish. They have nothing to do with each other. Today they run
at once, and the only hard part is that the answers must still line up with the questions.

The fourth piece is the tests. Five tools with fifteen error paths between them cannot be checked by
asking a model nicely. `bun test` runs them against a real temporary directory in under a second.

### The files you are about to write

| File | In React terms | Its job |
|---|---|---|
| `src/tools/glob.ts` | nothing in React, it is new | find files by name pattern, newest first |
| `src/tools/grep.ts` | nothing in React, it is new | find text inside files, two engines |
| `src/agent/loop.ts` | an edit, six lines | run a batch of calls at once, answer them in order |
| `bin/shrek.ts` | an edit, three lines | register the two new tools |
| `tests/tools.test.ts` | your first test file | every tool, every error path, no model |

> **New to TypeScript?** [`learn/ts/phase-2b.md`](./ts/phase-2b.md) explains every TypeScript
> construct this phase uses, in the order it appears, using these same pieces of code. The code
> blocks below link into it. You do not need it to finish the phase; it is there for when a line of
> syntax is in the way of the idea.

---

## What you'll learn

- **Order of execution and order of answers are different problems.** Three calls can run at once
  and their results still have to land in the array in the order they were asked, for a reason the
  API enforces.
- **A tool may have two engines behind one description.** Grep uses ripgrep when it is installed and
  its own search when it is not, and the model is never told which.
- **Tools are the part of an agent you can actually test.** No network, no key, no model. A
  temporary directory and a second.
- **Sorting is part of the interface.** Glob returns newest first and Grep groups by file, because
  the model reads the top of a list and stops.

---

## From the course

`../learn-claude-code/s02_tool_use/` gives you `run_glob` and nothing for Grep. Here it is whole:

```python
def run_glob(pattern: str) -> str:
    import glob as g
    matches = sorted({
        match for match in g.glob(pattern, root_dir=WORKDIR, recursive=True)
        if (WORKDIR / match).resolve().is_relative_to(WORKDIR)
    })
    shown = matches[:200]
    if len(matches) > 200:
        shown.append("... (more matches omitted; narrow the pattern)")
    return "\n".join(shown) if shown else "(no matches)"
```

Take three things from it directly. The result cap of 200, the sentence telling the model what to do
about the cap, and the path check applied to every match rather than only to the pattern. shrek
keeps all three, with `resolveInside` doing the third.

One thing changes. `sorted()` is alphabetical, and shrek sorts by modification time, newest first.
Alphabetical order puts `src/agent/` before `src/tools/` forever, whatever you have been working on.
The files a coding task is about are almost always the files somebody touched recently, and the model
reads the top of a list and stops reading. This is the phase's second example of the same idea as
part a's descriptions: the model's behaviour is shaped by what you put in front of it.

The chapter also states its position on running calls at once, in the README:

> The model often returns multiple tool_use calls at once. Calls are executed one by one in their
> original `response.content` order.

For five sequential tools in Python that is the right call, and it is what part a does. shrek
changes it because Read, Glob and Grep are all waiting on the disk, and three waits that could
overlap are three times the wall-clock time for no reason. What the chapter's sentence gets right,
and what you must keep, is the phrase "in their original order". That applies to the **answers**,
not to the work.

### The names to steal

Two declarations from `../claude-code/mods/types/claude-code.d.ts` are worth reading now that you
have written five tools.

The first is an entire engine event whose only payload is a description string:

```ts
/**
 * The input of `tool.describe`: one tool's description, at the moment the
 * engine first renders the tool's schema for the model.
 */
export type ToolDescribeInput = {
    tool: string;
    /**
     * The tool's description as it computed it.
     */
    description: string;
    isDeferred?: true;
    provider: Origin;
};
```

and the hook can rewrite it:

```ts
on("tool.describe", { tool: "Bash" }, ($, e) => ({ ...e, description }))
```

There are about 90 events in that file, and one of them exists so that a plugin can change the
wording a tool is introduced with. It is cached for the session and there is a separate call to
invalidate the cache. That is how much engineering the real system puts behind the thing part a made
you rewrite by hand. Take the confirmation: the description is a moving part of the system, not a
comment, and it is worth treating as something you tune.

The second is the shape of a call as the engine passes it around:

```ts
/**
 * `{ tool, tool_use_id, ...args }` as one flat object type.
 */
export type ToolInputOf<Name extends string, Arguments> = {
    [K in keyof ToolEnvelope<Name, Arguments>]: ToolEnvelope<Name, Arguments>[K];
};
```

The tool's own arguments sit **flat**, beside the envelope, so a Bash call is
`{ tool: "Bash", tool_use_id: "...", command: "ls" }` and not
`{ tool: "Bash", input: { command: "ls" } }`. Your `dispatch` keeps them apart, passing
`parsed.data` to `execute` and the id separately. Neither is wrong. Flattening makes a hook's
matcher and its argument access read the same way, `e.tool` and `e.command`, which is worth a lot
when you write hooks and nothing at all when you write tools. Phase 5 is where you will flatten
yours, and it is easier to know now that the shape changes then than to discover it mid-refactor.

---

## Anthropic to OpenAI translation

One row again, and it is the row part a never stressed because the calls were sequential.

| The course (Anthropic) | shrek (OpenRouter, OpenAI shape) |
|---|---|
| one `{role:'user', content:[tool_result, tool_result, tool_result]}` holding every result | one `{role:'tool', tool_call_id, content}` message **per call** |

Anthropic puts every result in one message, as a list of blocks each carrying its own
`tool_use_id`. The list is one value that you build and append once, so there is no way for the
results to end up in a different order than you put them in.

OpenAI gives you three separate messages appended one at a time, and the id lives on the message. So
the order is now something your code decides, on every round, and the obvious way to write parallel
execution gets it wrong:

```ts
const results: ToolResult[] = []
await Promise.all(calls.map(async (call) => {
  results.push(await registry.dispatch(call, ctx))     // pushes in completion order
}))
```

**The failure this phase will hit.** Not an error. The request succeeds, because every
`tool_call_id` is answered and the API is satisfied. The model reads a Read of `a.ts` labelled with
the id of the call that asked for `b.ts`, or rather it reads them in an order that does not match
the order it asked, and it quietly attributes the wrong output to the wrong file. You find out when
it edits the wrong one. This is why the loop edit in step 3 is six lines and why two of them are
about ordering.

---

## Background

**Why two engines behind Grep.** ripgrep is a search tool that is roughly ten times faster than
anything you will write, understands `.gitignore`, and skips binary files. It is also not installed
on most machines by default. A tool that exists only when a binary is present is worse than useless,
because the model has been told in the system prompt that it can search, and a tool that returns
`Error: rg not found` teaches it nothing except to go back to Bash. So Grep runs ripgrep when it can
find it and its own search when it cannot, and the description says neither. The model asked a
question and the answer is the same either way, which is the entire contract.

**Why the output modes exist.** The same search has three useful answers. "Which files mention
this", which is a list of paths and is what you want when you are about to read them. "Show me the
lines", which is what you want when the matches themselves are the answer. "How many per file",
which is what you want when you are deciding whether a rename is a five-minute job. Without the
modes the model gets every matching line of every file for every question, which on a common word in
a real repo is tens of thousands of tokens and often more than the context window holds. Making the
cheap answer the default is the single most useful thing in this file.

**Why running calls at once is safe here and not in general.** Three Reads at the same time are
three independent file handles and no shared state. Two Writes to the same path at the same time are
a race with no defined winner, and a Write and an Edit of the same file at the same time can produce
a file holding half of each. Nothing in this phase prevents that. What makes it acceptable is that
the model does not ask for two conflicting writes in one batch, because it has been trained on a
system that does exactly this, and that a run which does hit the race fails visibly rather than
silently. The real defence arrives in Phase 4, where a write needs your approval and approvals are
one at a time. Know the hole rather than believing it is closed.

**Why the tests come now and not in Phase 1.** The loop needs a model, a key and a network, so
testing it means either a real request, which is slow and nondeterministic, or a fake client, which
is a lot of scaffolding to assert that an array grew. Tools need none of that. `edit.execute` is a
function from arguments and a directory to a string, and every one of its error paths is one line of
setup away. The ratio is what matters: about a third of the code you have written so far is tool
code, and almost all of the behaviour worth protecting is in it.

---

## Worked example

Three calls, run at once. The model asks for a Read of `a.ts`, a Grep for `slugify`, and a Read of
`b.ts`, in one assistant message.

```ts
tool_calls: [
  { id: 'call_A', function: { name: 'Read',  arguments: '{"file_path":"src/a.ts"}' } },
  { id: 'call_B', function: { name: 'Grep',  arguments: '{"pattern":"slugify"}' } },
  { id: 'call_C', function: { name: 'Read',  arguments: '{"file_path":"src/b.ts"}' } },
]
```

The Reads take about 1ms each. The Grep takes 40ms, because it walks the whole project.

### Round 1: what finishes when

Predict the order the three results become available, and the order the three `tool` messages must
go into the array.

<details><summary>Predict, then open</summary>

They finish `call_A`, `call_C`, `call_B`. The two Reads are done before the Grep has opened its
third file.

They must be appended `call_A`, `call_B`, `call_C`. The order the model asked in.

Those two lists being different is the whole problem. Nothing enforces it: an array holding
`A, C, B` answers every `tool_call_id` and the request is accepted. The damage is that the model
reads the conversation as a sequence, and it wrote the calls in an order it had a reason for,
usually "the thing I most want to know first".

The fix is to keep the two orderings apart in the code rather than hoping they coincide.
`Promise.all` does exactly this and it is the reason to use it rather than a loop of `await`s:

```ts
const results = await Promise.all(calls.map((call) => registry.dispatch(call, ctx)))
```

`Promise.all` starts everything immediately and resolves to an array **in the order of the input**,
not the order of completion. So `results[1]` is `call_B`'s result even though it arrived last. Then
appending is an ordinary `for` over `results`.
</details>

### Round 2: the display lines

Part a yields a `turn.step` event with the display line before each call runs, so `Read(src/a.ts)`
is on screen while the file is being read. With all three running at once, predict where the three
`yield`s go.

<details><summary>Predict, then open</summary>

All three before the `Promise.all`, in a loop of their own:

```ts
for (const call of calls) {
  const { name, line } = opts.registry.renderCall(call)
  yield { type: 'turn.step', turnId, step, kind: 'tool', id: call.id, name, line }
}

const results = await Promise.all(calls.map((call) => opts.registry.dispatch(call, ctx)))
```

Three lines appear at once, then the terminal sits still for 40ms, then three results land. That is
an honest picture of what is happening, and in Phase 3 it is what lets the UI show three spinners.

The version that looks more natural is one loop doing both:

```ts
for (const call of calls) {
  yield { ...line event... }
  const result = await opts.registry.dispatch(call, ctx)   // this await is the bug
  ...
}
```

and it is part a's code unchanged, which is sequential. The `await` inside the loop is what makes it
sequential, and moving the `yield` around does not help. Splitting into two passes is not a style
choice, it is the only way to start the second call before the first finishes.
</details>

### Round 3: one of them throws

Suppose `dispatch` could throw, and `call_B`'s Grep throws because ripgrep is missing. Predict what
`Promise.all` does, and what the array looks like afterwards.

<details><summary>Predict, then open</summary>

`Promise.all` rejects as soon as any one of its promises rejects, and it rejects with that one
error. The other two promises keep running, because nothing can cancel them, and their results are
discarded.

So `await Promise.all(...)` throws, the `for` that appends the results never runs, and the array
holds an assistant message with three `tool_calls` and zero `tool` messages. Part a's round 5 ended
in one unanswered call. This ends in three, from one failure.

Which is why part a put the `try` inside `dispatch` rather than around the call to it. `dispatch`
returns `{ isError: true }` for a failed Grep, that result is an ordinary member of the array
`Promise.all` resolves to, and the other two are unaffected. The guarantee "dispatch never throws"
stopped being a nicety the moment calls went parallel.

`Promise.allSettled` is the other answer and it is the wrong one here. It never rejects, giving you
an array of `{ status, value }` or `{ status, reason }` objects that you then have to unwrap and
convert into error strings, which is `dispatch`'s job done twice, in the loop, where it does not
belong.
</details>

### Round 4: what the model sees for one common word

You run `Grep(pattern: "const")` on this repo with no `output_mode`. Predict the size of the result
in the three modes.

<details><summary>Predict, then open</summary>

Roughly, on the eleven files you have written so far:

- `files_with_matches`: about 10 lines, 100 tokens.
- `count`: about 10 lines, 150 tokens.
- `content`: about 200 lines, 3,000 tokens.

Now scale it. On a real repository of 2,000 files, `content` for a word like `const` is hundreds of
thousands of tokens, which is more than the context window holds, so the 50,000 character cap from
`guards.ts` cuts it off somewhere arbitrary and the model gets a random sample of a file it did not
choose.

`files_with_matches` on the same repository is a few hundred paths. Still large, still the right
shape: the model reads it, picks three, and Reads those.

This is why the default is the cheap mode and why the description explains all three. A default that
is correct but expensive is worse than one that is cheap and sometimes needs a second call, because
the expensive one costs you every time and the second call costs you only when it is needed.
</details>

---

## Your task

Five steps. Keep `bunx tsc --noEmit --watch` running.

### 1. src/tools/glob.ts

**Why.** Without this the model cannot find a file unless you name it, and Read's "does not exist"
error tells it to use Glob.

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

`Bun.Glob(...).scan()` hands back paths one at a time rather than all at once, which is why the loop
is `for await`. On a large tree that matters: you start filtering before the walk has finished.

The `stat` calls are the only slow part and they are already the lesson of this phase. `Promise.all`
over 200 files issues 200 `stat` calls at once and takes about as long as the slowest one.

`b.mtime - a.mtime` is descending, newest first. Getting the subtraction the wrong way round is a
silent bug that makes the tool worse without making it wrong, which is the hardest kind to notice.
The test in step 4 pins the order for exactly that reason.

`SKIP` is the regex you wrote in part a's guards. `node_modules` in a real project is more files than
everything else put together, and without this line every Glob result is dependency source code.

### 2. src/tools/grep.ts

**Why.** This is how the model finds anything it cannot guess the filename of. It is also the last
tool before the fizzbuzz test, and the fizzbuzz run uses Write, Bash and Edit to prove all five
work together.

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

  for await (const rel of new Bun.Glob(args.glob ?? '**/*').scan({ cwd: root, onlyFiles: true })) {
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

Six flags in, one output format out. That is the shape of a tool with two engines: everything the
caller can vary has to mean the same thing in both, so the parameter list is really a contract
between `withRipgrep` and `withJavaScript`.

`proc.exitCode > 1` is the ripgrep convention and it will catch you out. Exit code 1 means "searched
fine, found nothing", not "failed". Treating 1 as an error turns every empty search into a thrown
error. Codes above 1 are real problems, like a regular expression that does not compile, and those
throw so `dispatch` can label the result.

`--regexp` before the pattern, as a separate argument, is what stops a pattern beginning with `-`
from being read as a flag. The trailing `.` is the path, and running with `cwd: root` is what makes
ripgrep print paths relative to the search root, the same as the fallback. The
`replace(/^\.\//gm, '')` strips the `./` prefix ripgrep adds.

`new RegExp(args.pattern)` has no `g` flag on purpose. A regular expression with `g` keeps a
`lastIndex` between calls to `.test`, so the same expression tested against successive lines matches
every other one. It is a famous bug and this code would have it.

`SHREK_GREP=js` forces the fallback. It is read inside `execute` rather than at the top of the file
so a test can set it between calls, and step 4 uses it to prove the two engines agree.

Two honest differences between the engines. ripgrep reads `.gitignore` and skips what it says to
skip, and it detects binary files; the fallback approximates the first with `SKIP` and the second
with the size cap. And ripgrep is faster by a wide margin on anything real. The tool does not tell
the model which engine ran, because there is nothing it could usefully do with that.

Now register both in `bin/shrek.ts`:

```ts
import { glob } from '../src/tools/glob'
import { grep } from '../src/tools/grep'

const registry = createRegistry([bash, read, write, edit, glob, grep])
```

and add one line to `src/agent/systemPrompt.ts`, after the existing Read and Write sentence:

```ts
    'Use Glob to find files by name and Grep to find them by contents, before reading anything.',
```

That is the whole of adding two tools: two files, one array, one sentence. Nothing in `loop.ts`
changed, which is the chapter's claim, now tested twice.

### 3. src/agent/loop.ts, the parallel edit

**Why.** Three Reads taking 3ms instead of 3ms each is not the point. The point is Grep and Glob,
which take tens of milliseconds, and Bash calls that take seconds.

Replace the whole `for (const call of calls)` block from part a with two loops and one
`Promise.all`:

```ts
      for (const call of calls) {
        const { name, line } = opts.registry.renderCall(call)
        yield { type: 'turn.step', turnId, step, kind: 'tool', id: call.id, name, line }
      }

      const results = await Promise.all(
        calls.map((call) => opts.registry.dispatch(call, ctx)),
      )

      for (const result of results) {
        await add({ role: 'tool', tool_call_id: result.id, content: result.output })
        yield { type: 'turn.step', turnId, step, kind: 'result', id: result.id, output: result.output }
      }
```

*TypeScript here: [`Promise.all` over a mapped array](./ts/phase-2b.md#ts-2).*

Six lines, three properties. Every display line is yielded before any work starts. Every call starts
before any of them finishes. Every result is appended in the order the model asked, because
`Promise.all` resolves in input order rather than completion order.

Note what is not here. No `try`, no `allSettled`, no filtering of failures. `dispatch` returning an
error result rather than throwing is what makes all three of those unnecessary, and round 3 of the
worked example is what happens without it.

`await add(...)` stays inside a sequential `for`. Those are file appends to the transcript and they
must not interleave, which is the rule from Phase 1b.

### 4. tests/tools.test.ts

**Why.** Five tools have about fifteen failure paths between them, and you have been checking them
by asking a model and reading the output. This checks all of them in under a second, with no key and
no network, and it will tell you when Phase 4's permission layer breaks one.

Create the `tests/` folder. `tsconfig.json` already includes it, from Phase 0.

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

*TypeScript here: [`bun:test` and what `expect` knows](./ts/phase-2b.md#ts-6) ·
[`as const` on one property](./ts/phase-2b.md#ts-3).*

`mkdtemp` and not a fixed path like `/tmp/shrek-test`. Two runs at once would fight over a fixed
path, and on macOS `/tmp` is a symlink to `/private/tmp`, which breaks any comparison against a
resolved path. `mkdtemp` hands you a real path that is yours.

`ctx()` is a function, not a shared object. A single shared context would carry `readFiles` from one
test into the next, and the read-before-edit test would pass because an earlier test read the file.
That is the classic shared-fixture bug and it always passes locally first.

`utimes` sets the modification time explicitly. Writing `a.ts` then `b.ts` gives them times that may
be the same millisecond, so the Glob order test would pass or fail at random.

The first Read assertion ends with `     3\t`, an empty third line. `'a\nb\n'.split('\n')` is
`['a', 'b', '']`, because a trailing newline ends the second line rather than starting a third. Real
Claude Code numbers that phantom line too. It is worth pinning in a test so that a later change to
the numbering is visible rather than merely different.

The last four tests are about the registry and are the ones that will catch a Phase 4 or Phase 5
regression. They assert the exact error strings, which is the same thing as asserting the interface
the model is given.

### 5. Commit

```sh
bun test
bun run typecheck
git add -A
git diff --cached | grep -iE 'sk-or-|api[_-]?key'
git commit -m "phase 2b: glob, grep, parallel calls and tests"
```

---

## Test

Two things have to be true: the tests pass, and the model can carry a real task end to end using
the tools you wrote.

### bun test

```sh
bun test
```

```
 15 pass
 0 fail
Ran 15 tests across 1 file.
```

The timing line varies. The counts do not.

- A failure in `both engines find the same things` with two nearly identical strings means the sort
  is missing or the `./` prefix is not being stripped.
- A failure in `returns matches newest first` means the `sort` comparison is the wrong way round, or
  `utimes` did not run.
- A failure only when you run the whole file, and not when you run that test alone, means a shared
  `ctx` rather than a fresh one.

### The fizzbuzz task

```sh
mkdir -p /tmp/shrek-fizz && cd /tmp/shrek-fizz
bun run /Users/youruser/repo/your-agent/bin/shrek.ts -p "write a node script that prints fizzbuzz to 20, run it, fix any bug"
```

Substitute your own project path. If shrek stops with `no OpenRouter key`, it is because Bun reads
`.env` only from the current directory; put the key in `~/.shrek/config.json` as part a's Test
section describes. On stderr you get the tool lines, and they should look like this,
though the exact filename and byte count are the model's choice:

```
Write(fizzbuzz.js, 214 bytes)
$ node fizzbuzz.js
```

and if the script had a bug, two more:

```
Read(fizzbuzz.js)
Edit(fizzbuzz.js)
$ node fizzbuzz.js
```

Then a short answer. Check the work yourself:

```sh
node fizzbuzz.js | head -5
```

```
1
2
Fizz
4
Buzz
```

Three things to look for in that run, because each one is a piece of this phase working.

- `Write(...)` rather than `$ cat > fizzbuzz.js <<EOF`. The system prompt line from part a is doing
  its job.
- A `Read` before any `Edit`. If the model tried to Edit first it was refused, and it recovered.
  Look for the error in the transcript to confirm which happened.
- No `sed`. If you see one, the Edit description is not convincing enough, and step 7 of part a is
  the fix.

If the run ends with `turn ended with max_steps`, the free model has got stuck in a loop of running
the script and reading it again. Try once more, and if it persists set a paid model for one run:
`SHREK_MODEL=qwen/qwen3-coder-30b-a3b-instruct`. That is a limitation of the model rather than a bug
in your code, and Phase 21 makes a lesson of it.

### The search task

```sh
cd /Users/youruser/repo/your-agent
bun run bin/shrek.ts -p "which files mention slugifyCwd, and what do they do with it?"
```

```
Grep(slugifyCwd)
Read(src/paths.ts)
```

Two calls, not six. If you see six Reads, the model searched by reading everything, which means the
Grep description did not persuade it or Grep returned an error it could not act on.

### Deliberate failure: the fallback disagrees

```sh
bun run bin/shrek.ts -p "grep for slugifyCwd and show the matching lines"
SHREK_GREP=js bun run bin/shrek.ts -p "grep for slugifyCwd and show the matching lines"
```

Both answers should name the same files. They are two different search engines behind one
description, and the model cannot tell which one ran. If the second is missing results the first
found, check `SKIP` and the `MAX_FILE_BYTES` guard in the fallback; if the second has results the
first does not, the extra ones are almost certainly in a gitignored folder that ripgrep skipped on
purpose.

### Deliberate failure: results in completion order

This is the bug from the translation section, and it is worth producing once because nothing about
it looks wrong. In `loop.ts`, replace the `Promise.all` with the version that pushes:

```ts
      // add `ToolResult` to the `import type { Registry }` line at the top while you do this
      const results: ToolResult[] = []
      await Promise.all(
        calls.map(async (call) => {
          results.push(await opts.registry.dispatch(call, ctx))
        }),
      )
```

Then force a batch where one call is much slower than another:

```sh
bun run bin/shrek.ts -p "at the same time: read package.json, and run 'sleep 2 && echo done'"
```

Now compare the order of the questions with the order of the answers:

```sh
D=~/.shrek/projects/$(printf '%s' "$PWD" | tr -cs 'A-Za-z0-9' '-')
F=$(ls -t "$D"/*.jsonl | head -1)
jq -r 'select(.message.tool_calls) | .message.tool_calls[].id' "$F"
jq -r 'select(.message.role == "tool") | .message.tool_call_id' "$F"
```

Two lists with the same ids in a different order. The request succeeded, the model answered, nothing
reported an error, and the conversation on disk no longer says what the model asked for. Put the
`Promise.all` version back and run it again: same ids, same order.

- If both lists match even with the broken version, the model only made one call. Ask for two
  explicitly, as the prompt above does.

---

## Notes and gotchas

**ripgrep's exit code 1 means no matches.** Not an error. Every command-line search tool does this
and it is the single most common way to break a wrapper around one. Only codes above 1 are failures.

**`--regexp` is not decoration.** Without it, a pattern starting with `-` is read as a flag and
ripgrep either errors or searches for something else. The same applies to any tool you shell out to
with model-supplied input, and it is the argument-injection equivalent of SQL injection.

**A `g` flag on a reused `RegExp` breaks `.test`.** `/x/g.test(s)` advances `lastIndex` and the next
call starts from there, so testing a list of lines matches every other match. Never put `g` on an
expression you call `.test` on more than once.

**`Bun.Glob` patterns are not shell patterns.** `*.ts` matches only the current directory and
`**/*.ts` matches any depth. A model that sends `*.ts` expecting recursion gets an empty result, and
the `(no files match ...)` message with the pattern echoed back is how it works that out.

**`Bun.which` returns `string | null`, and it checks `PATH` at call time.** Calling it inside
`execute` rather than at module scope is what makes the environment variable switch work in a test,
and it costs one `PATH` lookup per search.

**`Array.prototype.sort` is stable in every current runtime.** That is what lets `stable()` sort by
path alone and keep the line numbers within a file in order. It was only guaranteed from ES2019, and
plenty of advice written before then says otherwise.

**macOS `/tmp` is a symlink to `/private/tmp`.** A `cwd` of `/tmp/x` with a resolved path of
`/private/tmp/x/a.ts` fails `resolveInside`'s prefix check. Use `mkdtemp` in tests, and if you make a
scratch directory by hand, `cd` into it and use `$PWD`.

**`bun test` finds files by name, not by config.** Anything matching `*.test.ts` under the project
is a test. There is no `testMatch` to set and no runner to install, which is why `tests/` needed no
setup beyond existing.

**Parallel writes to the same file are still a race.** Nothing here prevents two Writes to one path
in one batch. Phase 4's approval prompt is what makes it practically impossible, and until then it
is a known hole rather than a closed one.

---

## Recap

`src/tools/glob.ts` walks the tree with `Bun.Glob`, drops the folders `SKIP` names, stats every
match at once, sorts newest first and caps at 200 with a line telling the model to narrow the
pattern. The sort order is a deliberate part of the interface, because the model reads the top of
the list.

`src/tools/grep.ts` is one description over two engines. ripgrep when `Bun.which` finds it, a
`Bun.Glob` walk with a `RegExp` when it does not, both producing the same three output shapes and
the same stable ordering. The default mode returns paths only, which is the difference between a
hundred tokens and a hundred thousand on a common word.

`src/agent/loop.ts` yields every display line, starts every call with `Promise.all`, and appends
every result in the order the model asked. That last part is the OpenAI message shape's
contribution: results are separate messages rather than one list, so their order is now your code's
decision.

`tests/tools.test.ts` covers all five tools and the registry against a temporary directory, with no
model, no key and no network. Four of its fifteen tests assert exact error strings, which is the
same as asserting the interface the model was given.

Three questions to check you got it.

1. `Promise.all` rejects on the first failure and discards the rest. The loop uses it anyway, with
   no `try` around it. Explain what makes that safe, and name the one change to `registry.ts` that
   would make it unsafe.

2. Glob sorts by modification time and Grep sorts by path. Neither is alphabetical by accident. Give
   the reason for each, in terms of what the model does with the result.

3. `SHREK_GREP` is read inside `execute` rather than once at the top of the file, which costs a
   lookup on every search. Say what that buys, and name one other place in shrek where the same
   trade would be wrong.

---

Phase 2 is done. The model can find files, read them, change them and check its work, and adding a
seventh tool is one file and one word in an array. Phase 3 puts a real terminal interface in front
of all of it, built out of React components, and the events your loop has been yielding since Phase
1 are what feed it.
