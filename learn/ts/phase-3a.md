# TypeScript for Phase 3a

This covers the TypeScript that [`learn/phase-3a.md`](../phase-3a.md) introduces: React components
with types on them, state with a type on it, and the bridge that passes a function from
`bin/shrek.ts` into the UI. It assumes [phase 0](./phase-0.md) to [phase 2b](./phase-2b.md). Read it
straight through or one section at a time.

---

<a id="ts-1"></a>
## TS-1. `as const` on an object of colors

```ts
export const theme = {
  user: 'cyan',
  tool: 'green',
  error: 'red',
  dim: 'gray',
} as const
```

Without `as const`, TypeScript reads `theme.user` as `string`, because you could later write
`theme.user = 'pink'`. With it, every property is `readonly` and its type is the exact text:
`theme.user` is the type `'cyan'`.

That matters because Ink's `color` prop does not take any string. It takes color names it knows.
`'cyan'` fits. A plain `string` might not, and the checker would say so. You met `as const` on a
single value and on a tuple in [phase 0 TS-11](./phase-0.md#ts-11) and
[phase 2b TS-3](./phase-2b.md#ts-3); on an object it does the same thing to every property at once.

---

<a id="ts-2"></a>
## TS-2. `.tsx` files and typed props

```tsx
type Props = { line: string; output?: string }

export function ToolLine({ line, output }: Props) {
```

A file with JSX in it must end in `.tsx`. In a `.ts` file, `<Box>` is a syntax error, because in a `.ts`
file `<Box>value` already means something else: TypeScript's old way to write a type cast. That is the only difference between the
two extensions.

A component is a function whose one argument is the props object. `{ line, output }: Props` takes
that object apart and says what shape it has. The `: Props` is on the whole object, not on each
name; writing `{ line: string }` there would mean "rename `line` to `string`", which is a different
JavaScript feature.

Now the checker reads every use. `<ToolLine line={item.line} />` is fine because `output` is
optional (`?`). `<ToolLine />` is an error: `line` is missing. `<ToolLine line={42} />` is an error:
`number` is not `string`. In the browser with plain JS you would find these by looking at a broken
screen.

You never write the return type. TypeScript works out that returning JSX means `React.JSX.Element`.

---

<a id="ts-3"></a>
## TS-3. Narrowing `Item` inside a component

```tsx
export type Item =
  | { kind: 'user'; id: string; text: string }
  | { kind: 'text'; id: string; text: string }
  | { kind: 'tool'; id: string; line: string; output?: string }
  | { kind: 'error'; id: string; text: string }

function Row({ item }: { item: Item }) {
  switch (item.kind) {
    case 'tool':
      return <ToolLine line={item.line} output={item.output} />
```

This is the discriminated union from [phase 1a TS-7](./phase-1a.md#ts-7), the same pattern as
`AgentEvent`. `kind` is the tag. Inside `case 'tool':` the checker knows `item` is the tool shape,
so `item.line` is allowed. In `case 'user':`, `item.line` would be an error, because user items have
no `line`.

There is no `default`. Every `kind` has a `case` and every case returns, so TypeScript knows the
function cannot fall off the end. Add a fifth kind to `Item` without a case and `Row` fails to
compile, which is how you find every place that needs to learn about it.

Also note the props type is written inline here: `{ item }: { item: Item }`. For one prop that is
easier to read than a separate `type Props`.

---

<a id="ts-4"></a>
## TS-4. `useState<View>`

```tsx
export type View = { done: Item[]; live: Item[] }

const [view, setView] = useState<View>({ done: [], live: [] })
const [busy, setBusy] = useState(false)
```

`useState` is generic ([phase 1a TS-1](./phase-1a.md#ts-1)). It returns a value of whatever type
you give it, and a setter that only accepts that type.

For `busy`, TypeScript infers `boolean` from `false`, so no `<...>` is needed. For `view` it would
infer from `{ done: [], live: [] }`, and an empty array `[]` gives it nothing to go on, so it would
guess `never[]`, an array that can hold nothing. The first `setView` with a real item would then
fail. `<View>` says what the arrays will hold later.

The setter takes either a new value or a function from the old value:

```tsx
setView((v) => apply(v, event))
```

`v` is typed `View` without you writing it, because the setter knows its own type.

---

<a id="ts-5"></a>
## TS-5. Why `end` needs `: Item[]`

```ts
const end: Item[] =
  event.reason === 'answer'
    ? []
    : [{ kind: 'error', id: `${event.turnId}:end`, text: `turn ended: ${event.reason}` }]
return { done: [...done, ...live, ...end], live: [] }
```

Delete `: Item[]` and the `return` line fails:

```
Type '(... | { kind: string; id: string; text: string; })[]' is not assignable to type 'Item[]'.
```

When TypeScript infers a variable on its own, it widens literal text to `string`, because a
variable could change later. So `kind: 'error'` becomes `kind: string`, and `string` is not one of
the four kinds `Item` allows.

The other items in `apply` never hit this. They are written straight into the returned object,
where TypeScript already knows the target is a `View`, so it checks `'error'` against `Item` right
there and keeps it exact. A separate variable has no target until you give it one, and `: Item[]`
is that target.

---

<a id="ts-6"></a>
## TS-6. A function type as a prop

```ts
export type RunTurn = (prompt: string) => AsyncIterable<AgentEvent>

type Props = { run: RunTurn }
```

A prop can be a function, as with `onClick` in the browser. `RunTurn` names its shape. You give it
a prompt and get back something you can `for await` over that produces `AgentEvent`s
([phase 2b TS-1](./phase-2b.md#ts-1)).

In `bin/shrek.ts` the value passed is an async generator function:

```ts
async function* run(prompt: string): AsyncGenerator<AgentEvent> {
```

`AsyncGenerator<AgentEvent>` is not the same name as `AsyncIterable<AgentEvent>`, but it has
everything an `AsyncIterable` needs, so it fits. That is structural typing from
[phase 1b TS-3](./phase-1b.md#ts-3). Asking for the smaller type means `App` can only
iterate, not call `.return()` or `.next(value)` on the loop's generator.

This type is the whole contract between the two halves. `App` knows `RunTurn` and `AgentEvent`;
it never sees `RunOptions`, `client` or `registry`.

---

<a id="ts-7"></a>
## TS-7. `createElement` in a `.ts` file

```ts
import { createElement } from 'react'

const app = render(createElement(App, { run }))
```

`bin/shrek.ts` is a `.ts` file, and `package.json` points the `shrek` command at that exact name, so
it cannot hold JSX (TS-2). `<App run={run} />` is only shorthand for
`createElement(App, { run })`, so writing the call yourself gives the same element without
renaming the file.

It is still type-checked. `createElement` reads `App`'s props type and checks the object against
it. In 3b, `App` starts needing `model` and `cwd`; leave them out here and the call fails with
`No overload matches this call`, the same as a missing prop in JSX would.
