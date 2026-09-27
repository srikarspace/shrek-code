# TypeScript for Phase 1b

Part b is two small files, so there is less new language here than in part a. What it does introduce
is mostly about *choosing* types: when to describe a shape precisely and when to refuse to.

Assumes [phase 0](./phase-0.md) and [phase 1a](./phase-1a.md).

---

<a id="ts-1"></a>
## TS-1. Optional callbacks, and `?.()`

The loop gains one new option:

```ts
/** Called for every message added to the array, in order. The transcript writer. */
onMessage?: (message: ChatCompletionMessageParam) => Promise<void>
```

Read the type as a sentence: takes one `ChatCompletionMessageParam`, returns a promise of nothing.
The `?` makes the whole property optional, so a caller may leave it out, which Phase 9's sub-agents
do, and that is how they run the same loop while keeping no record.

Calling it needs the optional-call form:

```ts
async function add(message: ChatCompletionMessageParam): Promise<void> {
  messages.push(message)
  await opts.onMessage?.(message)
}
```

`f?.(x)` means "if `f` is `null` or `undefined`, do nothing and evaluate to `undefined`, otherwise
call it". Without the `?.` the checker refuses: *Cannot invoke an object which is possibly
`undefined`*.

And `await undefined` is legal and instant, so the `await` needs no guard of its own. That `await`
is load-bearing for a reason that has nothing to do with types: it is what keeps transcript lines in
the same order as the array. TypeScript cannot help you there: `Promise<void>` and `void` are
interchangeable in enough positions that a forgotten `await` on a function like this compiles
perfectly and reorders your file. Round 2 of the phase's worked example is that bug.

---

<a id="ts-2"></a>
## TS-2. `Record<string, unknown>`: choosing not to describe a shape

```ts
export type Transcript = {
  sessionId: string
  path: string
  write(type: string, fields: Record<string, unknown>): Promise<void>
}
```

`write` takes a `type` string and a bag of anything. That is a deliberate refusal to be specific,
and part b's third closing question is about why.

The precise alternative exists and looks better at first:

```ts
type TranscriptLine =
  | { type: 'session'; cwd: string; argv: string[] }
  | { type: 'message'; message: ChatCompletionMessageParam }
```

A [discriminated union](./phase-1a.md#ts-7), exactly like `AgentEvent`. The checker would then catch
a missing field, and `jsonl.ts` would be the one true list of line shapes.

`AgentEvent` **is** that union, and `write` is not, because they are different kinds of thing:

- `AgentEvent` is an **interface between two pieces of code you own**. The loop yields,
  `bin/shrek.ts` consumes, and both are in this repo. When Phase 6 adds a member, you *want* every
  consumer to fail to compile until it is handled.
- A transcript line is a **file format**. The writer is here, the readers are Phase 7, Phase 11,
  Phase 13, `jq` on the command line, and any hook somebody writes later. Phases 7 and 11 add new
  line types, and with a union every one of those is an edit to `jsonl.ts`, a file that should never
  need to change again.

So: a closed union when both ends are yours and you want breakage to be loud; an open bag when you
are writing something out for readers you have not met. `Record<string, unknown>` rather than
`Record<string, any>` keeps the values honest at least, since a reader has to check before using
them, which is [the `unknown` rule](./phase-0.md#ts-6) applied to a format.

The fields are merged in with a spread:

```ts
const line = { type, uuid: crypto.randomUUID(), timestamp: ..., sessionId, ...fields }
```

`...fields` last means a caller could overwrite `sessionId`. Nothing stops that, and nothing should
need to, because it is a private function in a file that never grows.

---

<a id="ts-3"></a>
## TS-3. Structural typing: an object that never says what it is

```ts
export async function openTranscript(cwd: string = process.cwd()): Promise<Transcript> {
  const sessionId = crypto.randomUUID()
  ...
  async function write(type: string, fields: Record<string, unknown>): Promise<void> { ... }

  await write('session', { cwd, argv: process.argv.slice(2) })
  return { sessionId, path, write }
}
```

The returned object literal is a `Transcript` and nowhere does anything declare that. It qualifies
because it has the three properties `Transcript` asks for, of the right types. This is **structural
typing**, the rule TypeScript uses everywhere, mentioned in [TS-3 in phase 0](./phase-0.md#ts-3) and
worth seeing in action.

Where the check happens matters. The `: Promise<Transcript>` on the function is what makes the
comparison happen at all. Remove it and the return type is inferred from the literal, so a typo
(`sessionID`) becomes part of the inferred type and the error moves to whoever uses the result,
later, in another file. The annotation puts the error on the line that is wrong.

Note also what this pattern replaces: a class. `write` is a plain function that closes over
`sessionId` and `path`, and those are genuinely private, not "private" by convention like a `_name`
property, but invisible, because nothing outside the function body has a reference to them. An
object of closures is the common shape in this codebase, and it is why there is no `class` keyword
anywhere in shrek.

`cwd: string = process.cwd()` is a **default parameter**. The type is `string`, but supplying it is
optional, so `openTranscript()` and `openTranscript('/tmp')` both compile. Same trick as
`projectDir` and `ensureStateDir` in Phase 0.

---

<a id="ts-4"></a>
## TS-4. Inference and mutable module state

```ts
let alsoToStderr = false

export function enableDebug(on: boolean): void {
  alsoToStderr = on
}
```

`let alsoToStderr = false` with no annotation infers `boolean`, not the literal `false`. That is a
rule worth knowing, and it is about `let` versus `const`:

```ts
let a = false      // boolean, since it can change, so the type allows both values
const b = false    // false, since it cannot change, so the type is exact
```

Which is why `enableDebug` compiles. Had the inference been `false`, assigning `on` would be an
error. So the mutability you wanted produced the type you needed, without a line of annotation.

Contrast `DEFAULTS ... as const` in Phase 0 ([TS-11](./phase-0.md#ts-11)), where the goal was the
opposite: lock the values down so nothing can reassign them.

`: void` as a return type means "returns nothing to use". An `async` version of the same thing is
`Promise<void>`, which is what `debug` returns.

---

<a id="ts-5"></a>
## TS-5. `catch` with nothing in the brackets

```ts
try {
  await appendFile(join(logsDir(), 'shrek.log'), `${line}\n`, 'utf8')
} catch {
  // A broken log must never take down a working agent.
}
```

`catch {` with no `(error)` is **optional catch binding**. Use it when you genuinely do not want the
error, which is the case exactly once in shrek: the logger. It also documents the intent: `catch
(error) {}` looks like you forgot to handle `error`, while `catch {}` says you decided not to.

Everywhere else you take the error, and it arrives as `unknown`, because JavaScript allows throwing
anything:

```ts
error instanceof Error ? error.message : String(error)
```

You cannot read `.message` until you have narrowed. See [TS-7 in phase 0](./phase-0.md#ts-7).

The `Transcript`'s `appendFile` deliberately has no `try` at all. A transcript that cannot be
written is a conversation being silently lost, so it should crash. The type system has no opinion on
this, since both versions compile, and that is the general shape of part b: the language checks the
shapes and you still have to make the decisions.

---

<a id="ts-6"></a>
## TS-6. Where globals like `crypto` and `Bun` get their types

```ts
const sessionId = crypto.randomUUID()
const file = Bun.file(path)
```

Neither is imported, and both type-check. That comes from one line in `tsconfig.json`:

```json
"types": ["bun"]
```

which loads the `@types/bun` package and declares the globals Bun provides: `Bun`, plus the web APIs
it implements like `crypto`, `fetch` and `Response`. If `crypto.randomUUID()` is ever flagged as
unknown, that line or that dependency is missing; it is never a problem with your code.

`import { appendFile } from 'node:fs/promises'` is the other half of the picture: Node's built-in
modules are imported by name, with the `node:` prefix, and `@types/bun` supplies those declarations
too.

Worth knowing the distinction in general. A `.d.ts` file is types with no implementation. It
describes code that already exists somewhere else. That is what `@types/*` packages are, what
`../claude-code/mods/types/claude-code.d.ts` is (which is why the phase documents can quote it
without running it), and what `tsc --noEmit` reads to know that `appendFile` takes a path, some
contents and an encoding.
