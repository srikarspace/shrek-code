# TypeScript for Phase 2a

This covers the TypeScript that [`learn/phase-2a.md`](../phase-2a.md) introduces: the registry's
shape, the new ways Zod is used, and three places where the checker knows something you have to help
it with. It assumes [phase 0](./phase-0.md), [phase 1a](./phase-1a.md) and
[phase 1b](./phase-1b.md). Read it straight through or one section at a time.

---

<a id="ts-1"></a>
## TS-1. A function that returns a string or throws

```ts
export function resolveInside(cwd: string, p: string): string {
  const root = resolve(cwd)
  const full = isAbsolute(p) ? resolve(p) : resolve(root, p)
  if (full !== root && !full.startsWith(root + sep)) {
    throw new Error(`path escapes the workspace: ${p}`)
  }
  return full
}
```

The signature says `: string`. It does not say "or throws". TypeScript has no checked exceptions,
which is the feature Java has where a function declares what it can throw and callers must handle
it. There is no equivalent and no plan for one.

That is a real gap and you should know its shape. Nothing in the type system will remind you that
`resolveInside` can fail, and nothing will warn a future caller. Only the doc comment says so, which
is why the comment on this function names the mechanism that catches it.

The compiler does understand that the `throw` ends the branch. Inside the `if`, control never
reaches the bottom, so `return full` is not "possibly unreachable" and `full` is still `string` at
the return. A function whose body always throws gets the type `never`:

```ts
function refuse(p: string): never {
  throw new Error(`path escapes the workspace: ${p}`)
}
```

`never` means "produces no value ever", which is different from `void`, meaning "produces a value
you should ignore". You will not need to write `never` today; recognising it in a hover is enough.

**The alternative the phase rejected**, spelled out in types:

```ts
function resolveInside(cwd: string, p: string): string | { error: string }
```

This one the checker *does* enforce, because no caller can use the result as a path until it has
narrowed away the object. That is the point and also the cost: five tools each write the same
three-line unwrap, and the function becomes unusable in a place where an escape really is a
programmer error. One `try` in `dispatch` buys the same safety in one location. The general rule:
return a union when every caller has something different to do about the failure, and throw when
they all want the same thing done in the same place.

---

<a id="ts-2"></a>
## TS-2. An object of methods as a return value

```ts
export type Registry = {
  list(): { name: string; description: string }[]
  toOpenAITools(): ChatCompletionFunctionTool[]
  renderCall(call: ChatCompletionMessageToolCall): { name: string; line: string }
  dispatch(call: ChatCompletionMessageToolCall, ctx: ToolContext): Promise<ToolResult>
}
```

Four **method signatures**. [TS-5 in phase 1a](./phase-1a.md#ts-5) introduced this notation on
`Tool<T>`; here it is the whole type. `Transcript` in [phase 1b](./phase-1b.md#ts-3) was the same
idea with one method, and `createRegistry` returns its object the same way, by
[structural typing](./phase-1b.md#ts-3), with nothing declaring the match except the return
annotation.

Two notations mean nearly the same thing:

```ts
list(): ToolInfo[]                // method shorthand
list: () => ToolInfo[]            // a property whose value is a function
```

Either compiles here. The difference is a rule called bivariance that only shows up when you pass
one function type where another is expected, and it will not bite you in this codebase. Use the
shorthand, because it is what `mods/types/claude-code.d.ts` uses and matching the reference is worth
more than the distinction.

What matters more is what is **not** in the type. `createRegistry` has two locals:

```ts
export function createRegistry(tools: AnyTool[]): Registry {
  const byName = new Map(tools.map((tool) => [tool.name, tool]))
  const schemas = tools.map(schemaOf)
  return { list: ..., toOpenAITools: ..., renderCall(call) {...}, dispatch(call, ctx) {...} }
}
```

`byName` and `schemas` are captured by the closures and are unreachable from outside. No `private`
keyword, no `#field`, no `class`. They are invisible rather than discouraged. Note also that the
methods never say `this`, so you can pull one off and pass it around and it still works:

```ts
const run = registry.dispatch      // fine, nothing breaks
```

A class method would lose its `this` the moment you did that.

`schemaOf` and `preview` are plain module functions outside the returned object, and `parseArguments`
too. The rule is simple: if it does not need the captured state, it is a function at module level. It
is easier to read, and in `edit.ts` it means `preview` can be tested without building a tool.

---

<a id="ts-3"></a>
## TS-3. `Set<string>` on the context

```ts
export type ToolContext = {
  cwd: string
  signal: AbortSignal
  /** Absolute paths Read has returned this run. Edit refuses a path that is not in here. */
  readFiles: Set<string>
}
```

`Set<T>` is a generic type, the same idea as
[`Map<K, V>` in phase 1a](./phase-1a.md#ts-9): a built-in collection with a type parameter. A
`Set<string>` holds strings, `has` takes a string, and `add` refuses anything else.

Membership is by `===`. For strings that is value equality, which is what Read and Edit need:

```ts
ctx.readFiles.add('/tmp/x/a.ts')
ctx.readFiles.has('/tmp/x/a.ts')   // true, a different string with the same characters
```

For objects it would be identity, so two identical objects are two members. Worth knowing before you
reach for `Set` again.

The interesting part is not the type, it is that `readFiles` is mutable state on a value that is
passed down:

```ts
const ctx: ToolContext = { cwd, signal, readFiles: new Set() }
```

`const` stops you reassigning `ctx`. It says nothing about the object's contents, and nothing about
the `Set` inside it, so `ctx.readFiles.add(path)` from inside a tool is legal and changes what a
later tool sees. That is deliberate here and it is the one place shrek does it.

If you wanted the checker to stop a tool mutating it, the type is `ReadonlySet<string>`, which has
`has` and `size` but no `add`. Read needs `add`, so the context cannot use it. You could give each
tool a different view of the same object, which is more type machinery than a four-line rule
deserves.

---

<a id="ts-4"></a>
## TS-4. Narrowing `call.type` before touching `call.function`

```ts
async dispatch(call, ctx) {
  const fail = (output: string): ToolResult => ({ id: call.id, output, isError: true })
  if (call.type !== 'function') return fail(`Error: unsupported tool call type ${call.type}`)

  const name = call.function.name
  ...
}
```

`ChatCompletionMessageToolCall` is a [discriminated union](./phase-1a.md#ts-7) from the OpenAI
package, tagged by `type`. One variant is `{ type: 'function', id, function: {...} }` and there is at
least one other. Before the `if`, `call.function` does not exist on every variant, so reading it is
an error:

```
Property 'function' does not exist on type 'ChatCompletionMessageCustomToolCall'.
```

After `if (call.type !== 'function') return ...`, the checker knows every path below it has
`type: 'function'`, so `call.function` is available for the rest of the function. That is the same
[narrowing](./phase-0.md#ts-7) rule as `if (error instanceof Error)`, applied to a tag rather than a
constructor. The early `return` is what makes it cover everything after, rather than only a block.

Note what you did **not** have to write:

```ts
const call2 = call as ChatCompletionMessageFunctionToolCall   // no
```

An [`as` assertion](./phase-0.md#ts-12) would compile and would be a lie the day OpenAI adds a
variant. The `if` produces the same access for free and produces a sensible tool result for the case
you did not plan for.

`renderCall` needs the same guard for the same reason, which is why both functions open with it.

---

<a id="ts-5"></a>
## TS-5. Zod modifiers, and what `z.infer` makes of each

[TS-3 in phase 1a](./phase-1a.md#ts-3) covered `z.infer<typeof params>`. This phase uses four
modifiers on top of it, and each changes the inferred type in a way worth being able to predict.

```ts
const params = z.object({
  file_path: z.string().describe('Path to the file, relative to the project directory or absolute.'),
  offset: z.number().int().min(1).optional().describe('First line to return, counting from 1.'),
  limit: z.number().int().min(1).optional().describe('How many lines to return.'),
})
```

```ts
type Args = z.infer<typeof params>
// { file_path: string; offset?: number | undefined; limit?: number | undefined }
```

- `.describe(text)` changes **nothing** about the type. It adds a `description` to the generated
  JSON Schema, which is how the text reaches the model. This is the one modifier whose whole purpose
  is outside TypeScript.
- `.optional()` makes the property optional, exactly as `key?: T` does by hand. This is why
  `execute` reads `offset ?? 1`.
- `.min(1)` and `.int()` are runtime checks and do not show in the type. `z.number().int()` still
  infers `number`, because TypeScript has no integer type. The check happens in `safeParse`, which
  is where it belongs: the value came off the network, not out of your code.
- `.min(1)` on `edit.ts`'s `old_string` is the same story. The type is `string`, and the empty
  string is rejected at parse time, with the message ending up in `dispatch`'s
  `invalid arguments for Edit: ...`.

One modifier to be careful with, which this phase avoids on purpose:

```ts
limit: z.number().default(2000)     // z.infer gives `number`, not `number | undefined`
```

`.default()` makes the field optional for the **caller** and required in the **output**, so the two
sides of the schema stop matching. `z.infer` gives you the output side, so `limit` is `number` and
the `?? DEFAULT_LIMIT` in your code looks dead to the reader even though the JSON Schema still marks
it optional. shrek uses `.optional()` plus `??` so that the default is written once, in the code,
where you can see it.

In `edit.ts`, `replace_all: z.boolean().optional()` infers `boolean | undefined`, and

```ts
if (count > 1 && !replace_all) { ... }
```

works because `undefined` is falsy. That is plain JavaScript, not TypeScript, and under `strict` the
checker allows `!x` on a `boolean | undefined` without complaint.

---

<a id="ts-6"></a>
## TS-6. `.catch(() => null)` and the narrowing it sets up

```ts
const info = await stat(path).catch(() => null)
if (!info) return `Error: ${file_path} does not exist. Use Glob to find the right path.`
if (info.isDirectory()) { ... }
if (info.size > MAX_FILE_BYTES) { ... }
```

`stat` returns `Promise<Stats>` and rejects when the file is missing. `.catch(() => null)` turns the
rejection into a value, so the expression is `Promise<Stats | null>` and `info` is `Stats | null`.

Then the `if (!info)` returns, and from the next line down `info` is `Stats`, with `.isDirectory()`
and `.size` available. One line converted a control-flow problem into a type the checker can narrow,
which is the whole trick.

Compare the two alternatives.

```ts
let info: Stats
try {
  info = await stat(path)
} catch {
  return `Error: ${file_path} does not exist.`
}
```

Correct, four lines instead of one, and `let` with no initialiser needs the annotation
([TS-10 in phase 1a](./phase-1a.md#ts-10)).

```ts
if (!(await Bun.file(path).exists())) return `Error: ...`
const info = await stat(path)
```

Two system calls instead of one, and `Bun.file(...).exists()` is false for a directory, so the
directory case gets the wrong message.

One caution. `.catch(() => null)` swallows **every** rejection, not only "not found". A permissions
error also becomes `null`, and the model is told the file does not exist. Here that is an acceptable
simplification because the next step is the same either way. Where the difference matters, check
`error.code === 'ENOENT'` instead, and remember the error arrives as `unknown`
([TS-5 in phase 1b](./phase-1b.md#ts-5)).

---

<a id="ts-7"></a>
## TS-7. `Map.get` returns `T | undefined`, always

```ts
const byName = new Map(tools.map((tool) => [tool.name, tool]))

const tool = byName.get(name)
if (!tool) {
  return fail(`Error: no tool named ${name}. Available: ${[...byName.keys()].join(', ')}`)
}
```

`Map<K, V>.get` is typed `(key: K) => V | undefined`, and there is no way to tell the checker that a
key is definitely present. That is correct rather than annoying: `name` came from the model, and the
model invents tool names constantly.

So the `if` is not defensive coding, it is the only way to reach the `tool` variable at all. Without
it, `tool.params` fails with *`tool` is possibly `undefined`*. With it, the error message you were
going to have to write anyway is also what satisfies the checker.

`tools.map((tool) => [tool.name, tool])` infers `(string | AnyTool)[][]`, an array of arrays, which
is not what `new Map` wants. It works here because `new Map`'s own generic signature pushes the
expected type inward and the tuple is inferred as `[string, AnyTool]`. If you ever extract that line
into a variable it stops working, and the fix is `as const` on the pair or an explicit
`[string, AnyTool]` annotation. [TS-10 in phase 0](./phase-0.md#ts-10) covers tuples.

`[...byName.keys()]` spreads an iterator into an array so `join` is available. `keys()` returns a
`MapIterator<string>`, which has no `join` of its own.

While you are here, the related rule from `tsconfig.json`. `noUncheckedIndexedAccess: true` makes
array indexing behave the same way:

```ts
const first = lines[0]      // string | undefined, because of that flag
```

which is why `read.ts` uses `slice` and `map` rather than indexing, and why `page.map((line, i) =>
...)` gives you a plain `string`: a map callback's parameter is not an indexed access.

---

<a id="ts-8"></a>
## TS-8. The one `as` in the registry

```ts
function schemaOf(tool: AnyTool): ChatCompletionFunctionTool {
  const parameters = z.toJSONSchema(tool.params) as Record<string, unknown>
  delete parameters.$schema
  return {
    type: 'function',
    function: { name: tool.name, description: tool.description, parameters },
  }
}
```

Two things here need explaining and they are connected.

`z.toJSONSchema` returns Zod's own precise description of a JSON Schema document, with named
properties including `$schema`. The `openai` package wants `parameters` typed as a loose
`Record<string, unknown>`. Those two are not assignable to each other in either direction, and
neither library is wrong. The [`as` assertion](./phase-0.md#ts-12) is you telling the checker you
have read both and they agree in practice.

This is the second `as` in shrek, and both are at a library boundary. That is the pattern to hold
yourself to: an assertion is acceptable where two packages describe the same JSON differently, and
is a bug anywhere inside code you own.

`delete parameters.$schema` is what forces the widening. On Zod's precise type, `delete` on a
required property is an error:

```
The operand of a 'delete' operator must be optional.
```

That rule exists because deleting a required property leaves an object that lies about its own type.
Here the object is about to leave TypeScript entirely and become JSON on a network request, so the
lie has no victim. Widening to `Record<string, unknown>` first is the honest way to say that: the
value is now a bag of JSON, and the compiler stops tracking its shape at exactly the point where you
stopped caring.
