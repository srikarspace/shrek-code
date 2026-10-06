# TypeScript for Phase 3b

This covers the TypeScript that [`learn/phase-3b.md`](../phase-3b.md) introduces: the types on
Ink's keyboard hooks, defaults for optional props, refs, and state that starts out empty. It assumes
[phase 3a](./phase-3a.md) and everything before it. Read it straight through or one section at a
time.

---

<a id="ts-1"></a>
## TS-1. `useInput` and the `Key` object

```tsx
useInput(
  (input, key) => {
    if (key.return) {
```

You never wrote a type for `input` or `key`, yet `key.return` autocompletes and `key.retrun` is an
error. Ink declares `useInput`'s first argument as a function of type
`(input: string, key: Key) => void`. When you pass an arrow function straight into a slot like
that, TypeScript gives its parameters the slot's types. This is called contextual typing; it is the
same thing that typed `v` in `setView((v) => ...)` in [phase 3a TS-4](./phase-3a.md#ts-4).

`Key` is an object of booleans, one per special key: `upArrow`, `return`, `backspace`, `ctrl` and
so on. Ctrl+C arrives as `input === 'c'` with `key.ctrl === true`, which is why `App` checks both.

`usePaste` works the same way with a smaller slot, `(text: string) => void`.

---

<a id="ts-2"></a>
## TS-2. A default for an optional prop

```tsx
type Props = { onSubmit: (text: string) => void; isActive?: boolean }

export function Input({ onSubmit, isActive = true }: Props) {
```

`isActive?: boolean` means callers may leave it out, so from the outside its type is
`boolean | undefined` ([phase 0 TS-5](./phase-0.md#ts-5)).

`isActive = true` inside the braces is a default, used when the prop is missing. TypeScript
follows that, so inside the function `isActive` is plain `boolean`, never `undefined`, and you can
pass it on to `{ isActive }` without a check. `<Input onSubmit={submit} />` works and means
"active".

---

<a id="ts-3"></a>
## TS-3. `useRef<AbortController | null>`

```tsx
const turn = useRef<AbortController | null>(null)

if (turn.current) turn.current.abort()
```

A ref is a box with one property, `current`, that survives re-renders but does not cause them. The
type in `<...>` is what the box can hold. Here it is "a controller, or nothing", and it starts as
nothing.

Because the type includes `null`, every read has to deal with it. `turn.current.abort()` on its own
is an error: `'turn.current' is possibly 'null'`. The `if (turn.current)` narrows it
([phase 0 TS-7](./phase-0.md#ts-7)), and inside the `if` it is an `AbortController`.

Writing `useRef(null)` without the type would make the box hold only `null` forever, and
`turn.current = controller` would be an error. With `useState` you would hit the same problem as
the empty arrays in [phase 3a TS-4](./phase-3a.md#ts-4); the fix is the same, say the type up front.

---

<a id="ts-4"></a>
## TS-4. `useState<number>()` with no starting value

```tsx
const [lastMs, setLastMs] = useState<number>()
```

No argument, so the starting value is `undefined`, and React's types make `lastMs` a
`number | undefined`. That is right, because before the first turn finishes there is no duration.

It then fits straight into `StatusBar`, whose prop is `lastMs?: number`. An optional prop accepts
`undefined`, so `<StatusBar lastMs={lastMs} />` needs no check. The check happens once, inside
`StatusBar`, where `lastMs === undefined` picks the "no turn yet" text.

---

<a id="ts-5"></a>
## TS-5. `?? ''` after reading an array slot

```tsx
setValue(next === 0 ? '' : (sent[sent.length - next] ?? ''))
```

You know `sent.length - next` is in range, because `next` was clamped between 0 and `sent.length`
the line before. TypeScript does not follow that arithmetic. With `noUncheckedIndexedAccess` on
([phase 0 TS-15](./phase-0.md#ts-15)), any `array[i]` is typed `string | undefined`, and `setValue`
only takes `string`.

`?? ''` ([phase 0 TS-8](./phase-0.md#ts-8)) settles it. If the slot is empty, the value is an empty
string. It costs nothing at runtime and keeps the setter's type exact. The same pattern appears in
`ToolLine`'s `lines[0] ?? ''` from 3a.
