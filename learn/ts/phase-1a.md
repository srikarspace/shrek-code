# TypeScript for Phase 1a

The TypeScript that `learn/phase-1a.md` introduces. Phase 0's file covers the basics: annotations,
`type` aliases, unions, `unknown` and narrowing. This one assumes them. Links back to it look like
[TS-6 in phase 0](./phase-0.md#ts-6).

Phase 1a is where the types start doing design work rather than just catching typos.

---

<a id="ts-1"></a>
## TS-1. Generics: a type with a hole in it

`Tool<T>` is the first type in shrek that takes an argument.

```ts
export type Tool<T> = {
  name: string
  description: string
  params: z.ZodType<T>
  execute(args: T, ctx: ToolContext): Promise<string>
  renderLine(args: T): string
}
```

`T` is a **type parameter**. Same idea as a function parameter, except you pass a type instead of a
value, and you pass it in angle brackets. `T` is just a conventional name; `Tool<Args>` would read
better and everyone writes `T` anyway.

So `Tool` on its own is not a type yet, it is a template. `Tool<{ command: string }>` is the
finished type, and it is what you get by substituting:

```ts
{
  name: string
  description: string
  params: z.ZodType<{ command: string }>
  execute(args: { command: string }, ctx: ToolContext): Promise<string>
  renderLine(args: { command: string }): string
}
```

This is why `const bash: Tool = { ... }` does not compile. The error is *Generic type `Tool<T>`
requires 1 type argument(s)*. It is the same complaint as calling a function with no arguments.

**Why bother.** A non-generic version would have to say `execute(args: object)`, and then `execute({
command })` inside `bash` could not destructure `command`, because `object` has no properties. `T`
is what carries "this particular tool's arguments look like this" from the tool's definition down
into its own `execute` and `renderLine`, while the loop, which handles every tool, never needs to
know.

You have already used generics without writing one: `Promise<string>`, `Record<string, ModelInfo>`,
`Array<string>`. `Tool<T>` is the same mechanism, now yours.

---

<a id="ts-2"></a>
## TS-2. `typeof` in a type position

TypeScript has two separate worlds and they use some of the same words.

- **Values** exist when the program runs: variables, functions, objects.
- **Types** exist only while the checker is looking. They are erased.

`typeof` appears in both, meaning different things, and which one you get is decided by *where* you
wrote it.

```ts
if (typeof value === 'string')      // value world: JavaScript's runtime check
const params = z.object({ ... })    // a value
type Args = typeof params           // type world: "the type of that value"
```

`params` is a real object sitting in memory, a Zod validator. `typeof params` in a type position
asks the checker what it knows about that object, which is:

```ts
ZodObject<{ command: ZodString }>
```

Notice what that is: the type of the *validator*, not the type of the data the validator accepts.
Still not what you want. [TS-3](#ts-3) is the other half.

Why do it at all? Because the alternative is writing the shape down twice. `typeof` lets a type be
derived from a value you already wrote, so there is one source of truth and nothing to keep in sync.

---

<a id="ts-3"></a>
## TS-3. `z.infer<typeof params>`, read right to left

Zod is a runtime validator: `params.safeParse(x)` actually checks `x` while the program runs. It
also carries enough type information for the checker to work out what a validated value looks like.
`z.infer` is how you ask.

```ts
const params = z.object({ command: z.string().describe('The shell command to run.') })

export const bash: Tool<z.infer<typeof params>> = { ... }
```

Three steps, innermost first:

| Expression | What it is |
|---|---|
| `params` | a value: the Zod validator |
| `typeof params` | `ZodObject<{ command: ZodString }>`, the validator's type |
| `z.infer<typeof params>` | `{ command: string }`, the data's type |
| `Tool<z.infer<typeof params>>` | a tool whose `execute` takes `{ command: string }` |

`z.infer` is a type that computes another type from the one you give it. You cannot write one of
those yourself yet, and you do not need to; using them is the common case.

**You could skip all of it.** `Tool<{ command: string }>` compiles and behaves identically today.
The reason not to is drift. Add a field:

```ts
const params = z.object({
  command: z.string(),
  timeout: z.number().optional(),   // the only edit
})
```

With `z.infer`, `T` becomes `{ command: string; timeout?: number }` immediately, so `execute({
command, timeout })` destructures and `renderLine` sees it too. With the hand-written type, the
validator now accepts `timeout` at runtime while the type insists it does not exist, so the value
arrives and the checker refuses to let you read it. One schema, three uses (JSON Schema for the
model, runtime check, TypeScript type), and that is the "cannot drift" claim in the phase document
made concrete.

Hover `bash.execute` in your editor, add a field to `params`, hover again. The signature changes
without you touching it.

---

<a id="ts-4"></a>
## TS-4. `any`, and the one place shrek uses it

`any` means "stop checking". Any property access is allowed, any call, any assignment. It is not a
type so much as a hole in the type system, and it spreads: read a property off an `any` and the
result is `any` too.

```ts
export type AnyTool = Tool<any>
```

That is the only `any` in the project, and it is there for a specific reason. `bash` is a `Tool<{
command: string }>`. Phase 2's `read` tool is a `Tool<{ path: string; offset?: number }>`. The loop
needs to hold both in one array.

There is no honest shared type. `Tool<unknown>` will not do: if `execute` takes `unknown`, then
handing it a `{ command: string }` is fine, but a `Tool<{command: string}>` is not a
`Tool<unknown>`, because its `execute` demands more than `unknown` provides. (The general rule is
that a type parameter used in a *parameter* position flips the direction of assignability. You do
not have to remember the rule, only that it bites here.)

So `Tool<any>` it is, and the safety moves rather than disappearing:

```ts
const parsed = tool.params.safeParse(raw)     // runtime check, every time
if (!parsed.success) return { error: ... }
return { tool, args: parsed.data }            // only now can execute be called
```

By the time any `execute` receives `args`, Zod has checked it. The type system was never going to be
able to do that job anyway, since the arguments arrive as a string from a model over the network, so
losing it there costs nothing real.

Treat any other `any` as a bug. `unknown` ([TS-6 in phase 0](./phase-0.md#ts-6)) is almost always
what you actually wanted.

---

<a id="ts-5"></a>
## TS-5. Functions inside types

A type can describe a function-shaped property in two styles:

```ts
execute(args: T, ctx: ToolContext): Promise<string>    // method style
renderLine: (args: T) => string                        // property style
```

`(args: T) => string` is a **function type**: takes a `T`, returns a `string`. The arrow is part of
the type, not code. `RunOptions` uses the property style for its optional callback:

```ts
signal?: AbortSignal
maxSteps?: number
```

and Phase 1b adds `onMessage?: (message: ChatCompletionMessageParam) => Promise<void>`.

The two styles are interchangeable for our purposes, and shrek uses the method style when a tool
must supply the function and the property style for anything optional. Optional properties are [TS-5
in phase 0](./phase-0.md#ts-5).

What matters is that a function type constrains both directions. When you write `bash.renderLine`,
the checker knows `command` is a string without you saying so:

```ts
renderLine: ({ command }) => `$ ${command}`
```

No annotation anywhere on that line. The type came from `Tool<T>`, which came from `z.infer`, which
came from the schema. That is **contextual typing**: a value written in a position that already has
a type gets that type for free.

---

<a id="ts-6"></a>
## TS-6. A union of results, and the `in` check

```ts
type Prepared = { tool: AnyTool; args: unknown } | { error: string }
```

Either a validated tool call, or the exact string to send the model instead. `prepare` returns one
or the other and never throws, which is the whole reliability argument of the phase expressed as a
type.

To use it you must work out which side you are holding. Neither side has a `type` field, so the
check is on the presence of a property:

```ts
const line = 'error' in ready ? `${name}(?)` : ready.tool.renderLine(ready.args)
```

`'prop' in obj` is JavaScript, and TypeScript narrows on it: inside the true branch `ready` is `{
error: string }`, inside the false branch it is `{ tool: AnyTool; args: unknown }`. Reach for
`ready.tool` on the wrong side and it is a compile error, not `undefined` at three in the morning.

This is the same shape Zod hands back from `safeParse`:

```ts
{ success: true; data: T } | { success: false; error: ZodError }
```

and the reason `if (!parsed.success) return ...` before `parsed.data` is not optional. Before that
check, `parsed.data` does not exist as far as the checker is concerned.

The alternative design is returning `{ tool, args, error }` with everything optional, and then every
use site has to check two fields and handle three impossible combinations. A union says "exactly one
of these", and the checker enforces it.

---

<a id="ts-7"></a>
## TS-7. Discriminated unions

`AgentEvent` is a union of six object types that all share one property:

```ts
export type AgentEvent =
  | { type: 'turn.start'; turnId: string; text: string }
  | { type: 'turn.step'; turnId: string; step: number; kind: 'text'; text: string }
  | { type: 'turn.step'; turnId: string; step: number; kind: 'tool'; id: string; name: string; line: string }
  | { type: 'turn.step'; turnId: string; step: number; kind: 'result'; id: string; output: string }
  | { type: 'turn.abort'; turnId: string }
  | { type: 'turn.complete'; turnId: string; answer: string; durationMs: number; isAborted: boolean; reason: TurnCompleteReason }
```

Every member has `type`, and every `type` is a different [literal](./phase-0.md#ts-4). That property
is the **discriminant**, and comparing it narrows the union to one member:

```ts
if (event.type === 'turn.complete') {
  console.log(event.answer)      // fine: this member has answer
}
console.log(event.answer)        // error: most members do not
```

If you have written Redux, this is exactly an action union and a reducer, with the same payoff.

Two subtleties from shrek's version.

**Nested discriminants.** Three members share `type: 'turn.step'` and are told apart by `kind`. So
you narrow twice, and `bin/shrek.ts` does:

```ts
if (event.type === 'turn.step' && event.kind === 'tool') console.error(event.line)
```

`event.line` exists only after both checks. Drop the `kind` check and it stops compiling, because
the `'text'` member has no `line`.

**Exhaustiveness.** In a `switch` over `event.type` where every case returns, the checker knows the
end of the switch is unreachable. Add a member in Phase 6 and forget a case, and the value that
falls through is no longer `never`, which surfaces as an error. That is a compile-time reminder to
update every consumer, and it is most of why the events are a union instead of `{ type: string;
data: any }`.

---

<a id="ts-8"></a>
## TS-8. `AsyncGenerator<Yield, Return, Next>`

```ts
export async function* runAgent(opts: RunOptions): AsyncGenerator<AgentEvent, void, void> {
```

`async function*`, which is `async` plus a star, is an **async generator**. This section has two
halves. First the JavaScript, because generators are a language feature you may never have met.
Then the three type arguments, which is the only TypeScript part.

### The keyword is JavaScript, not TypeScript

`yield` is plain JavaScript and has been since 2015. It is only legal inside a function declared
with a star, and outside one it is a syntax error:

```js
function* f() { yield 1 }   // fine
function  g() { yield 1 }   // SyntaxError
```

A `function*` is a **generator function**. Add `async` and you get an async generator, which is what
`runAgent` is.

A normal function is all or nothing. You call it, it runs to the bottom, it hands back one value
with `return`, and it is finished. A generator function can hand back a value and **stay alive,
frozen on the line it stopped at**, remembering every local variable. Ask it for another value and it
thaws and carries on from exactly there.

So `return` means "here is my answer, I am done", and `yield` means "here is a value, wake me when
you want the next one".

### Watch it freeze

Calling a generator function runs **none** of its body. You get back an **iterator**, an object with
a `.next()` method. Each `.next()` runs the body as far as the next `yield`. Save this as `gen.ts`
anywhere and run `bun run gen.ts`:

```ts
function* countdown() {
  console.log('  [gen] starting')
  yield 3
  console.log('  [gen] woke up, sending 2')
  yield 2
  console.log('  [gen] done')
}

const it = countdown()
console.log('created it; nothing has run yet')
console.log('caller got', it.next())
console.log('caller got', it.next())
console.log('caller got', it.next())
```

```
created it; nothing has run yet
  [gen] starting
caller got { value: 3, done: false }
  [gen] woke up, sending 2
caller got { value: 2, done: false }
  [gen] done
caller got { value: undefined, done: true }
```

Read the interleaving rather than the values. `[gen] starting` printed after `created it`, so the
body really had not begun. After that the two halves take turns, and taking turns is exactly what
is what the loop needs: hand back one event, wait, carry on.

`{ value, done }` is the raw protocol. `for...of` and `for await...of` are sugar over it: they call
`.next()` until `done` is `true` and give you each `value`.

### The async half, and why shrek needs it

Add `async` and the body may `await` between yields, which `runAgent` does on every model call. The
consumer writes `for await` instead of `for`:

```ts
async function* slowCountdown() {
  for (const n of [3, 2, 1]) {
    await Bun.sleep(100)
    console.log(`  [gen] yielding ${n}`)
    yield n
  }
}

for await (const n of slowCountdown()) {
  console.log('caller received', n)
  await Bun.sleep(500)      // a deliberately slow consumer
}
```

```
  [gen] yielding 3
caller received 3
  [gen] yielding 2
caller received 2
```

Notice what did not happen. The generator did not run ahead during the consumer's 500ms sleep. It
sat frozen at its `yield` until the consumer came back. The consumer sets the pace, and that is the
property the stage document's Background section is pointing at when it rejects `onText` callbacks:
a callback fires whether or not you are ready, and then you need your own queue.

If you have used Redux, `yield` looks like `dispatch` and is not. `dispatch` pushes to any number of
subscribers registered elsewhere and returns immediately. `yield` hands one value to the single
caller that asked for it and blocks until that caller asks again. Phase 5 is where the events do get
a real bus with subscribers.

### The three type arguments, in order

| Position | Here | Meaning |
|---|---|---|
| `Yield` | `AgentEvent` | what each `yield` produces, the one you care about |
| `Return` | `void` | what a final `return` produces; nothing here |
| `Next` | `void` | what the caller may pass *into* `next()`; nothing here |

The third one is unusual and almost always `void`. Generators can receive values (`const x = yield
y`), shrek's never does, so `void` says "do not send me anything".

The payoff on the consuming side is that `for await` types the loop variable for you:

```ts
for await (const event of runAgent({ ... })) {
  // event: AgentEvent
}
```

Combined with [TS-7](#ts-7), that is a fully checked event consumer with one annotation in the whole
file, the one on `runAgent`.

---

<a id="ts-9"></a>
## TS-9. `Map<K, V>`, and inference doing you a favour

```ts
const byName = new Map(opts.tools.map((tool) => [tool.name, tool]))
```

`Map` is a real JavaScript class, generic in its key and value types. Nothing here is annotated, yet
`byName` comes out as `Map<string, AnyTool>` and `byName.get(name)` as `AnyTool | undefined`.

That works because `Map`'s constructor expects an array of `[key, value]` pairs, and that
expectation flows backwards into the `.map` callback, so `[tool.name, tool]` is read as a
two-element tuple rather than a loose array. Contextual typing again, and the reason tuples ([TS-10
in phase 0](./phase-0.md#ts-10)) are worth knowing about.

`.get` returning `V | undefined` is not the `noUncheckedIndexedAccess` flag, it is `Map`'s own type,
because a lookup can always miss. Which forces the branch that produces a genuinely useful message:

```ts
const tool = tools.get(call.function.name)
if (!tool) {
  const known = [...tools.keys()].join(', ')
  return { error: `Error: no tool named ${call.function.name}. Available: ${known}` }
}
```

A `Map` rather than a plain object, because the keys are data that arrives from a model. Plain
objects inherit keys like `constructor` and `toString`, so `tools['toString']` finds a function that
is not a tool. A `Map` has no inherited keys.

---

<a id="ts-10"></a>
## TS-10. `let x: string` with no value yet

```ts
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
```

Declared with a type and no initial value, then assigned on every path. TypeScript traces the paths:
miss one, and using `output` afterwards is *Variable `output` is used before being assigned*.

That is the phase's central rule, that every failure produces a string and nothing escapes between
pushing the assistant message and pushing its results, checked by the compiler. `let output = ''`
would have compiled too, and would have silently sent an empty tool result on the path you forgot.
The bare declaration is the version that cannot be forgotten.

Prove it to yourself: delete the `catch` block's assignment and watch where the error lands.

---

<a id="ts-11"></a>
## TS-11. Borrowing types from a library

```ts
import type OpenAI from 'openai'
import type {
  ChatCompletionMessageParam,
  ChatCompletionMessageToolCall,
} from 'openai/resources/chat/completions'
```

The `openai` package ships its own types, so the exact shape of a message is already written down by
the people who built the API. Import it instead of describing it again.

```ts
const messages: ChatCompletionMessageParam[] = [
  { role: 'system', content: systemPrompt(cwd) },
  { role: 'user', content: opts.prompt },
]
```

`ChatCompletionMessageParam` is itself a discriminated union, keyed on `role`. So `{ role: 'tool' }`
with no `tool_call_id` is a compile error, and `{ role: 'user', tool_call_id: '...' }` is too. Some
of the message-shape rules are enforced for you, though not the
important one, since no type can check that every `tool_call_id` got an answer.

`import type` rather than `import` because these are only ever types; see [TS-14 in phase
0](./phase-0.md#ts-14). `OpenAI` is imported as a type in `loop.ts` (it only appears in
`RunOptions`) and as a value in `client.ts`, where `new OpenAI(...)` needs the real class.

One more borrowed type, in `types.ts`:

```ts
const parameters = z.toJSONSchema(tool.params) as Record<string, unknown>
delete parameters.$schema
```

`z.toJSONSchema` returns a precise type that does not permit `delete`. The `as` widens it to a plain
bag so the key can be removed, a small and deliberate use of the escape hatch from [TS-12 in phase
0](./phase-0.md#ts-12).
