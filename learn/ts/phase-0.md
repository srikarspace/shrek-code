# TypeScript for Phase 0

Every piece of TypeScript that `learn/phase-0.md` uses, explained once. Read a section when the
phase document links to it, or read the whole file first if you prefer. Every example is real code
from shrek, not invented code.

You are assumed to know JavaScript and React. Nothing else.

---

<a id="ts-1"></a>
## TS-1. What TypeScript is

TypeScript is JavaScript plus notes about what kind of value goes where. You write `.ts` files, a
checker reads your notes, and it tells you when two notes disagree before you run anything.

The notes are deleted before the code runs. This is the single most important fact about the
language. `const x: number = 5` runs as `const x = 5`. There is no type in memory, nothing to
inspect, no cost at runtime.

So TypeScript can only catch mistakes it can see in your source. It cannot check what comes back
from the network or out of a file, because that arrives while the program is running, long after the
checker went home. That is why Phase 0 hand-checks the config file with `typeof` and Phase 1 uses
Zod. The checker guards the inside of your program; you guard the edges yourself.

Bun runs `.ts` files directly, so nothing compiles the types away in a build step. `bunx tsc
--noEmit` is the checker on its own: read everything, report problems, produce no output files.

---

<a id="ts-2"></a>
## TS-2. Annotations: `: type`

A colon after a name says what belongs there.

```ts
function slugifyCwd(cwd: string): string {
  return cwd.replace(/[^A-Za-z0-9]+/g, '-')
}
```

`cwd: string` is the parameter. The `: string` after the brackets is the return value. Call it with
a number and the checker complains at the call, which is where the mistake actually is.

You mostly annotate **parameters** and **return types**, and leave variables alone:

```ts
const line = JSON.stringify({ ... })   // TypeScript works out: string
```

That is **inference**. The checker reads the right-hand side and fills in the type. Writing `const
line: string = ...` is not wrong, it is just noise. The rule of thumb: annotate the boundaries of a
function, let the inside infer itself.

Annotating a return type is worth doing even when inference would manage, because it pins the
promise the function makes. Change the body so it returns the wrong thing and the error lands inside
the function instead of somewhere far away that used it.

---

<a id="ts-3"></a>
## TS-3. `type` aliases: naming a shape

A `type` gives a name to a shape so you can use it in many places.

```ts
export type ModelInfo = {
  id: string
  context: number
  inputPerToken: number
  outputPerToken: number
  free: boolean
}
```

Now `ModelInfo` means "an object with those five properties, of those five kinds". Use it anywhere a
type can go: `function costOf(info: ModelInfo, ...)`.

Two things surprise people coming from other languages.

**It is not a class.** No `new`, no methods, nothing exists at runtime. An ordinary object literal
"is" a `ModelInfo` if it happens to have the right properties. Nobody declares that it is.

**Matching is by shape, not by name.** This is called *structural typing* and it is why the object
literal inside `Object.fromEntries` is accepted as a `ModelInfo` without ever saying so.

Note the doc comments on the individual properties. `/** USD per input token. */` shows up when you
hover the property in your editor. That is the whole reason the codebase puts a comment above every
export.

---

<a id="ts-4"></a>
## TS-4. Unions: `A | B`

`|` means "one of these".

```ts
export type Config = {
  model: string
  apiKey: string | undefined   // a string, or nothing at all
  baseURL: string
  debug: boolean
}
```

`apiKey: string | undefined` is a fact about shrek written into the type: there may be no key. Every
piece of code that touches `config.apiKey` is now forced to deal with that possibility, which is
exactly why `--version` can honestly print `key: missing`.

A union member can also be one specific value, not just a kind of value:

```ts
export function keyStatus(config: Config): 'ok' | 'missing' {
```

`'ok'` as a *type* means "the string `ok` and no other string". So this function may return exactly
two things, and `if (keyStatus(c) === 'okay')` is a compile error rather than a branch that silently
never runs. These are **literal types**, and they do the job an `enum` does in other languages.

To use a value of a union type you have to work out which member you are holding. That is
[narrowing](#ts-7).

---

<a id="ts-5"></a>
## TS-5. Optional properties: `key?: T`

A `?` before the colon means the property can be missing.

```ts
type FileConfig = { model?: unknown; apiKey?: unknown; baseURL?: unknown; debug?: unknown }
```

Every key optional, because the config file is allowed to contain any subset of them, and that is
the lesson Phase 0 takes from the real Claude Code settings examples.

`model?: unknown` and `model: unknown | undefined` are nearly the same thing, with one difference:
the `?` version lets you leave the key out entirely when you build such an object, the other makes
you write `model: undefined`. Prefer `?`.

---

<a id="ts-6"></a>
## TS-6. `unknown`, and why it is not `any`

Both mean "I do not know what this is". They behave in opposite ways.

`any` switches the checker off for that value. You can do anything to it and nothing is reported,
including the thing that crashes.

`unknown` keeps the checker on. You can hold the value and pass it around, but you cannot use it
until you have proved what it is.

```ts
function pick(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}
```

Delete the `typeof value === 'string'` and `value.trim()` stops compiling: *`value` is of type
`unknown`*. That error is the feature. The value came out of `JSON.parse`, so it genuinely could be
a number, `null`, or an array, and `pick` exists precisely to find out. `unknown` is the type that
makes you write the check you were going to skip.

Rule for the whole project: anything arriving from outside the program, whether a JSON file, an API
response or a command-line string, starts life as `unknown`.

---

<a id="ts-7"></a>
## TS-7. Narrowing: how the checker reads your `if`

TypeScript follows your control flow. Inside a branch, it knows more than it did outside.

```ts
if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
  throw new Error(`${path}: expected a JSON object`)
}
return parsed as FileConfig
```

After that `throw`, the checker has ruled out non-objects, `null` and arrays, so the rest of the
function is reasoning about a narrower type than `unknown`.

The checks it understands:

- `typeof x === 'string'` (also `'number'`, `'boolean'`, `'object'`, `'function'`, `'undefined'`)
- `x instanceof Error`, for classes
- `x === null`, `x === undefined`, `x === 'ok'`
- plain truthiness: `if (config.apiKey)` narrows `string | undefined` to `string`
- `Array.isArray(x)`

You use `instanceof` narrowing in every error handler in the project:

```ts
error instanceof Error ? error.message : String(error)
```

`catch` gives you `unknown`, because JavaScript permits `throw 'a string'` and libraries do. So
`error.message` is not allowed until you have checked, and the `String(error)` branch is what you do
when the thrown thing was not an `Error` at all.

Narrowing is the everyday way you use a union. You do not convert the value; you prove which member
it is, and the checker keeps up.

---

<a id="ts-8"></a>
## TS-8. `?.` and `??`

These two are plain JavaScript, not TypeScript, but Phase 0 leans on both and the types change
around them.

`a?.b` is **optional chaining**: if `a` is `null` or `undefined`, the whole expression is
`undefined` instead of throwing.

```ts
const value = process.env[name]?.trim()
```

`process.env[name]` may be `undefined`, so `.trim()` on it would crash. With `?.` the result is
`string | undefined`, and the type says so.

`a ?? b` is **nullish coalescing**: use `a`, unless it is `null` or `undefined`, then use `b`.

```ts
model: envStr('SHREK_MODEL') ?? pick(file.model) ?? DEFAULTS.model
```

The type falls out of it neatly. `envStr` returns `string | undefined`, `DEFAULTS.model` is a
`string`, so `??` strips the `undefined` and the result is `string`, which is what `Config.model`
demands. If you delete the last link, the line stops compiling, because `string | undefined` is not
a `string`. The precedence chain is checked, not just documented.

`||` looks similar and falls through on `0`, `''` and `false` as well. Round 4 of the phase 0 worked
example is that difference being a bug.

---

<a id="ts-9"></a>
## TS-9. Generic types: `Record`, `Readonly`, `Promise`

Some types take another type in angle brackets, the way a function takes an argument.

```ts
Record<string, ModelInfo>    // an object with string keys and ModelInfo values
Readonly<Config>             // a Config whose properties cannot be reassigned
Promise<string>              // a promise that resolves to a string
Promise<void>                // a promise that resolves to nothing useful
string[]                     // an array of strings, shorthand for Array<string>
```

`Record<K, V>` is how you describe a lookup table. `MODELS` is one:

```ts
export const MODELS: Record<string, ModelInfo> = Object.fromEntries(...)
```

The annotation is doing real work. `Object.fromEntries` cannot know what you built, so without it
`MODELS` would be a vague object and `MODELS[id]` would be `any`, with no checking at all, all the
way down.

`Readonly<Config>` is the return type of `loadConfig`. `Object.freeze` genuinely freezes the object
when the program runs, and TypeScript types it as `Readonly<T>`, so an accidental `config.model =
'x'` later is caught at compile time *and* blocked at runtime. Belt and braces, on purpose, because
config is passed everywhere.

`void` means "returns nothing you should use". `Promise<void>` is the type of an `async` function
with no `return`.

You will write your own generic type in Phase 1a: `Tool<T>`.

---

<a id="ts-10"></a>
## TS-10. Arrays, tuples and `readonly`

`string[]` is an array of strings, any length.

A **tuple** is an array of a fixed length where each position has its own type:

```ts
const TABLE: [string, number, number, number][] = [
  ['qwen/qwen3.8-27b:free', 262_144, 0, 0],
  ...
]
```

Read the outer `[]` last: an array of `[string, number, number, number]`. So every row must have
exactly four entries in exactly that order. Add a fifth or swap the id and the context size, and the
checker catches it. With a plain `any[][]` it would not.

Tuples are what makes destructuring safe:

```ts
TABLE.map(([id, context, inPerM, outPerM]) => ...)
```

`id` is `string`, the other three are `number`, and nobody annotated anything. The tuple type
supplied all four.

`readonly` in front of an array type forbids the mutating methods:

```ts
export const FREE_FALLBACKS: readonly string[] = ...
```

`FREE_FALLBACKS.push('x')` is now an error. It is a shared constant, so nothing should be adding to
it.

---

<a id="ts-11"></a>
## TS-11. `as const`

`as const` on a literal says "this is exactly these values, and do not let anyone change them".

```ts
export const DEFAULTS = {
  model: DEFAULT_MODEL,
  baseURL: 'https://openrouter.ai/api/v1',
  debug: false,
} as const
```

Without it, `debug` would have type `boolean` and `baseURL` would be `string`. With it, `debug` is
the literal `false`, `baseURL` is that exact URL, and every property is read-only.

The point here is the read-only part. `DEFAULTS` is the bottom layer of the config, imported in
several places, and a bug that mutates it would change what every later run defaults to. `as const`
makes that a compile error instead of an afternoon.

---

<a id="ts-12"></a>
## TS-12. `as`: overruling the checker

`x as T` says "trust me, it is a `T`". It is not a conversion and it checks nothing at runtime. It
only changes what the checker believes.

```ts
return parsed as FileConfig
```

That is honest here, and only because of the lines above it. `parsed` has already been proved to be
a non-null, non-array object, and `FileConfig` has every property optional and typed `unknown`, so
the claim being made is nearly nothing: "this is an object that might have some keys". Each key is
still checked later by `pick`.

Treat `as` as a small debt. Every one of them is a place where you, not the checker, are responsible
for being right. `parsed as Config` would have been a lie, and would have handed `null` to the
OpenRouter request body with the checker's blessing.

There are exactly two `as` in Phase 0's code. If you find yourself writing a third to make an error
go away, the error is usually correct.

---

<a id="ts-13"></a>
## TS-13. `async`, `await` and `Promise<T>`

The same `async`/`await` you know from React data fetching. The only new part is the type.

An `async` function always returns a promise, so its annotation is always `Promise<something>`:

```ts
async function readFileLayer(path: string): Promise<FileConfig>
export async function loadConfig(): Promise<Readonly<Config>>
export async function ensureStateDir(cwd?: string): Promise<string>
```

You write `return {}` inside `readFileLayer`, not `return Promise.resolve({})`, because `async`
wraps it for you. And `await` unwraps in the other direction, so `const file = await
readFileLayer(...)` gives you a `FileConfig`, not a promise of one.

Forget an `await` and the type usually catches you: `Promise<FileConfig>` has no `.model`, so
`file.model` fails to compile. Usually, not always, which is why Phase 1b has a worked example about
a missing `await` reordering a file.

---

<a id="ts-14"></a>
## TS-14. `import type`

```ts
import { configPath } from './paths'        // a function; exists at runtime
import type { Config } from '../config'     // a type; vanishes
import pkg from '../package.json'
```

Because types are deleted before the code runs ([TS-1](#ts-1)), an import used only as a type must
also be deleted. The `type` keyword marks it so that can happen without the compiler having to
guess.

`verbatimModuleSyntax: true` in `tsconfig.json` makes this mandatory: imports are emitted exactly as
written, so an unmarked type import would survive into the running program and try to load something
that is not there. The checker tells you exactly what to add.

`import { loadConfig, type Config } from '../src/config'` mixes both in one line, which is the form
`bin/shrek.ts` uses.

Importing `package.json` and reading `pkg.version` off it works because of `resolveJsonModule:
true`. TypeScript reads the actual file and types it from the real contents, so `pkg.version` is
known to be a string and a typo in the property name is an error.

---

<a id="ts-15"></a>
## TS-15. The two `tsconfig.json` lines that change how you write code

Most settings in that file are plumbing. Two change your daily experience.

**`strict: true`** turns on a group of checks. The one you notice is `strictNullChecks`: without it,
`null` and `undefined` are quietly allowed everywhere and `string` silently means "a string or
nothing". With it, `string | undefined` has to be written down and dealt with, which is what makes
[TS-4](#ts-4) and [TS-8](#ts-8) worth anything. Never turn it off.

**`noUncheckedIndexedAccess: true`** says that looking something up by key or index might find
nothing:

```ts
export function lookupModel(id: string): ModelInfo | undefined {
  return MODELS[id]
}
```

`MODELS` is a `Record<string, ModelInfo>`, so by default `MODELS[id]` would be typed `ModelInfo`, a
confident lie, since `id` can be any string at all. With this flag it is `ModelInfo | undefined` and
the return type has to admit it.

It applies to arrays too, which is why `argv[flag + 1]` in later phases is `string | undefined` and
has to be checked. This flag is the reason several of the "what if it is missing" branches in shrek
exist at all. The checker asked for them.
