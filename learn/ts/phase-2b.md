# TypeScript for Phase 2b

This covers the TypeScript that [`learn/phase-2b.md`](../phase-2b.md) introduces: iterating over
something that arrives over time, running work in parallel with the types intact, and three small
pieces of Zod and object typing that the two search tools lean on. It assumes
[phase 0](./phase-0.md), [phase 1a](./phase-1a.md), [phase 1b](./phase-1b.md) and
[phase 2a](./phase-2a.md). Read it straight through or one section at a time.

---

<a id="ts-1"></a>
## TS-1. `for await` over something that is not an array

```ts
for await (const rel of new Bun.Glob(pattern).scan({ cwd: root, onlyFiles: true })) {
  if (!SKIP.test(rel)) found.push(rel)
}
```

`scan()` does not return `string[]`. It returns an **async iterable** of strings, typed
`AsyncIterableIterator<string>`, which is a thing you can ask for the next value of, one at a time,
where each answer is a promise. `for await` is the loop that does that asking, and `rel` is `string`
inside the body, fully narrowed, with no unwrapping.

You have seen the other half of this. [TS-8 in phase 1a](./phase-1a.md#ts-8) built
`async function* runAgent()`, which **produces** values over time, and `bin/shrek.ts` consumes it
with `for await`. `scan()` is the same protocol with a different producer: Bun walks the directory
tree and hands you each path as it finds it.

Why it matters here rather than being a curiosity. On a directory with 40,000 files, an array means
walking all of them, building a 40,000 element array, and only then starting to filter. The async
iterable lets `SKIP` reject `node_modules` entries as they appear. Memory stays flat and the first
result is available immediately.

If you want the array anyway, there is a helper:

```ts
const all = await Array.fromAsync(new Bun.Glob(pattern).scan({ cwd: root }))
```

`Array.fromAsync` is the async version of `Array.from`. The code in this phase does not use it,
because the filter is cheaper than the array.

One rule that catches people. `for await` is only legal inside an `async` function, the same as
`await`. Both `execute` methods that use it are already `async`, so it never comes up here.

---

<a id="ts-2"></a>
## TS-2. `Promise.all` over a mapped array

Two uses in this phase, and the types work the same way in both.

```ts
const results = await Promise.all(
  calls.map((call) => opts.registry.dispatch(call, ctx)),
)
```

`calls.map(...)` produces `Promise<ToolResult>[]`, an array of promises, because the callback
returns what `dispatch` returns. `Promise.all` is typed so that `Promise<T>[]` in gives
`Promise<T[]>` out, so after the `await`, `results` is `ToolResult[]`. No annotation anywhere, and
the element type survives the round trip.

The other use adds a small wrinkle:

```ts
const timed = await Promise.all(
  found.map(async (rel) => ({ rel, mtime: (await stat(join(root, rel))).mtimeMs })),
)
// timed: { rel: string; mtime: number }[]
```

The callback is `async`, so it returns `Promise<{ rel: string; mtime: number }>` even though the
body looks like it returns an object. That is what `async` does to a return type, from
[TS-13 in phase 0](./phase-0.md#ts-13). `Promise.all` unwraps one layer and you get the array of
plain objects.

The loop uses the same shape to time each call: its `async` callback returns
`{ ...result, durationMs: Date.now() - calledAt }`, so `results` comes out as an array of tool
results that each carry one extra `durationMs: number`. Order is still the input order.

Note the extra parentheses in `async (rel) => ({ ... })`. Without them the `{` starts a function
body rather than an object literal, and the function returns `undefined`. That is plain JavaScript
and it is the most common typo in this file.

**Ordering, which is the reason this section exists.** `Promise.all` resolves to results in the
order of the **input array**, not the order they finished. That is a guarantee in the language, not
an accident of scheduling, and the whole parallel tool-call edit depends on it.

**Rejection.** If any promise rejects, `Promise.all` rejects immediately with that error and the
other results are lost. The types do not show this, since `Promise<T[]>` says nothing about failure.
`Promise.allSettled` is the alternative and gives you
`PromiseSettledResult<T>[]`, a union per element that you have to narrow on `.status` before you can
read `.value`. shrek does not use it, because `dispatch` never rejects, so there is nothing to
settle.

---

<a id="ts-3"></a>
## TS-3. `as const` on a tuple, then `z.enum`, then back to a type

```ts
const MODES = ['files_with_matches', 'content', 'count'] as const

const params = z.object({
  output_mode: z.enum(MODES).optional().describe('...'),
})

type Mode = (typeof MODES)[number]
```

Three steps, each doing one job.

`as const` ([TS-11 in phase 0](./phase-0.md#ts-11)) makes `MODES` a
`readonly ['files_with_matches', 'content', 'count']` rather than `string[]`. The exact strings are
now part of the type. Without it, `z.enum(MODES)` has nothing but `string` to work with and the
whole chain collapses.

`z.enum(MODES)` builds a Zod schema that accepts only those three strings. It produces a JSON Schema
with an `enum` key, so the model is told the closed set rather than being asked to guess from the
description, and `safeParse` rejects a fourth value at runtime.

`(typeof MODES)[number]` is an **indexed access type**, read right to left as in
[TS-3 in phase 1a](./phase-1a.md#ts-3). `typeof MODES` is the readonly tuple type. Indexing an array
type by `number` means "the type of any element of it", which here is the union
`'files_with_matches' | 'content' | 'count'`. That union is `Mode`, and it is what `RG_FLAG` and the
two engine functions are typed against.

One list of strings, written once, producing a runtime validator, a schema for the model, and a
TypeScript union. Compare the version where you write the three strings in three places: the day
someone adds a fourth mode, two of the three still compile.

The same operator turns up as a one-off in the test file:

```ts
const args = { pattern: 'const x', glob: '*.ts', output_mode: 'content' as const }
```

Without `as const`, `output_mode` is inferred as `string`, which is not assignable to `Mode`, and
the call to `grep.execute` fails to compile. The assertion here means "keep the literal type", which
is the same job `as const` does on the array, applied to one property.

---

<a id="ts-4"></a>
## TS-4. A property name that is not a valid identifier

```ts
const params = z.object({
  '-i': z.boolean().optional().describe('Match case insensitively.'),
})
```

```ts
if (args['-i']) argv.push('--ignore-case')
```

`-i` is not a legal variable name, so the key is quoted where the object is written and accessed
with brackets rather than a dot. `args.-i` is a syntax error. TypeScript handles the rest normally:
`z.infer` gives the property type `boolean | undefined`, the checker knows `args['-i']` exists, and
misspelling it as `args['-I']` is caught.

It is here because real Claude Code's Grep tool takes a parameter called `-i`, and matching a name
the model has seen before is worth more than a tidier `ignore_case`. Weak models produce `-i`
unprompted.

Two related things worth knowing while you are here.

Destructuring needs a rename, because the natural target name is also illegal:

```ts
const { '-i': ignoreCase } = args      // fine
```

which is why `grep.ts` takes the whole `args` object into `execute` rather than destructuring it in
the parameter list the way the other four tools do.

And an object type can allow names you have not listed, with an **index signature**:

```ts
type Loose = { tool: string; [argument: string]: unknown }
```

That is the shape `BuiltinToolCallInputFallback` uses in the standards file, for the case where a
tool's arguments are not declared anywhere. shrek has no index signatures, because every argument it
accepts is in a Zod schema.

---

<a id="ts-5"></a>
## TS-5. `Record<Mode, string>` as a table the compiler checks

```ts
const RG_FLAG: Record<Mode, string> = {
  files_with_matches: '--files-with-matches',
  content: '--line-number',
  count: '--count',
}
```

`Record<K, V>` ([TS-9 in phase 0](./phase-0.md#ts-9)) builds an object type with one property per
member of `K`. Because `Mode` is a union of three literals rather than `string`, the record has
exactly three keys, and all three are required:

- Leave one out and the checker says *Property 'count' is missing*.
- Add a fourth and it says *Object literal may only specify known properties*.
- Add a fourth mode to `MODES` and this object stops compiling until you give it a flag.

That last one is the point. The table is not documentation that can drift, it is a list the compiler
makes you keep complete. `RG_FLAG[mode]` is then `string` with no `undefined` in it, which is the
one case where indexing is safe under `noUncheckedIndexedAccess`: the key's type guarantees the
property exists.

Compare the `switch` you would otherwise write, which needs a `default` branch that can only throw,
and which the compiler will not tell you about when a fourth mode appears. The stage document's
preference for table-driven code over branches is this, made concrete.

`Record<string, unknown>` is the same operator with `string` as the key, which is the opposite
situation: any key, nothing guaranteed. Both appear in shrek within twenty lines of each other, in
`registry.ts` and here, and it is worth seeing that the difference is entirely in `K`.

---

<a id="ts-6"></a>
## TS-6. `bun:test`, and what `expect` knows about your value

```ts
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
```

`bun:test` is built into the runtime, so there is nothing to install and nothing to configure. Its
types come from `@types/bun`, which `tsconfig.json` already loads via `"types": ["bun"]`
([TS-6 in phase 1b](./phase-1b.md#ts-6)).

`expect(value)` is generic over what you pass it, which is why the matchers you get are typed:

```ts
expect(out).toBe('     1\tconst x = 1\n     2\tconst y = 1\n     3\t')
expect(out).toStartWith('Error: nope.ts does not exist')
expect(c.readFiles.has(join(dir, 'src/a.ts'))).toBe(true)
```

`toStartWith` is available because `out` is `string`. On a `number` it is not offered, and using it
is a compile error rather than a confusing failure at run time. `toBe` is `===`, so it is right for
strings and booleans and wrong for objects, where `toEqual` compares structurally.

Two typing details specific to this file.

```ts
let dir = ''
```

not `let dir: string`. `beforeAll` assigns it, and the compiler cannot see that `beforeAll` runs
before the tests, so an unassigned `let dir: string` is reported as used before assignment
([TS-10 in phase 1a](./phase-1a.md#ts-10)). Initialising to the empty string is the cheapest honest
answer. The alternative, `let dir!: string`, uses the definite assignment assertion `!`, which is a
promise to the compiler that you cannot keep.

```ts
function ctx(): ToolContext {
  return { cwd: dir, signal: new AbortController().signal, readFiles: new Set() }
}
```

The return annotation is doing real work, exactly as it did for `openTranscript` in
[phase 1b](./phase-1b.md#ts-3). It is what makes the test file fail to compile when Phase 4 adds a
field to `ToolContext`, which is the moment you want to hear about it. `new Set()` with no type
argument infers `Set<unknown>` on its own, and the annotation is what makes it `Set<string>`.

Finally, `expect(() => resolveInside(dir, '../escape.txt')).toThrow(...)` takes a **function**, not
a call. Passing `resolveInside(dir, '../escape.txt')` directly would throw while building the
argument, before `expect` ever ran, and the test would error instead of passing.
