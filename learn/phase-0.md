# Phase 0: project setup

About an hour. Most of it is typing seven small files.

---

## What we are building

shrek is a coding agent that lives in your terminal. When it is finished you will type this:

```sh
shrek -p "how many TypeScript files are in this repo?"
```

and get an answer back.

The interesting part is how. shrek does not know the answer. It sends your question over the
internet to an AI model, and along with the question it sends a message that means roughly: *you
are allowed to run shell commands, read files and edit files. You cannot do them yourself. Ask me
and I will do them for you.*

So the model replies "run `ls src/**/*.ts | wc -l`". shrek runs it on your machine, sends the
output back, and the model writes the final answer. That loop is the entire product. You build it
in Phase 1.

### Where Phase 0 fits

Before any of that can happen, shrek has to know four boring things:

1. **Which AI model am I talking to?** There are dozens. Some are free, some cost money.
2. **What is my API key?** The password that lets me talk to it.
3. **Where do I save the conversation?** So you can scroll back tomorrow.
4. **Where do I write debug logs?** So when it breaks you can read the raw network traffic.

Phase 0 answers those four and nothing else. At the end you have one command that prints the
answers and exits. It never contacts the AI.

That is on purpose. If the model name is wrong or the key is missing, you want to find out from a
command that runs in 50 milliseconds, not in Phase 1 while you are also debugging your first API
call. Every later phase assumes these four answers already exist.

### The files you are about to write

| File | In React terms | Its job |
|---|---|---|
| `package.json` | same thing | dependencies and scripts |
| `tsconfig.json` | same thing | TypeScript settings |
| `bin/shrek.ts` | `index.js`, the entry point | read command-line flags, print, set the exit code |
| `src/config.ts` | your settings loader | answers questions 1 and 2 |
| `src/paths.ts` | nothing in React, it is new | answers questions 3 and 4 |
| `src/llm/models.ts` | a constants file | the list of AI models, their sizes and their prices |
| `src/llm/client.ts` | your `api.js` wrapper around `fetch` | the object Phase 1 uses to call the AI |

Seven files. That is the phase.

> **New to TypeScript?** [`learn/ts/phase-0.md`](./ts/phase-0.md) explains every
> TypeScript construct this phase uses, in the order it appears, using these same pieces of code.
> The code blocks below link into it. You do not need it to finish the phase; it is there for when
> a line of syntax is in the way of the idea.

---

## What you'll learn

- **Layered config.** How a program decides between a built-in default, a saved preference and a
  one-off override, and why that decision belongs in one function.
- **Why the model list has prices in it.** Phase 7 adds a cost counter, and it has to get the
  numbers from somewhere.
- **Turning a folder path into a filename.** Every tool that saves per-project data needs this.
- **Entry point versus library.** The file that prints things and the files that compute things
  should be different files.

---

## From the course

Most phases start from a chapter of a Python course in `../learn-claude-code/`. Phase 0 does not,
because that course has 17 chapters about agents and zero about project setup. This phase is
shrek's own setup.

The reference instead is two example files in `../claude-code/examples/settings/`, from the real
Claude Code repo. First, do not mix up two similarly-named files:

| File | Whose | What is in it | Built in |
|---|---|---|---|
| `~/.shrek/config.json` | yours, one per computer | which model, which API key | Phase 0 |
| `<project>/.shrek/settings.json` | one per project | which tools need your approval | Phase 4 |

Those examples are of the **second** kind. You are building the **first** kind today. So read them
for exactly one lesson.

Here is the entirety of `settings-lax.json`:

```json
{
  "permissions": { "disableBypassPermissionsMode": "disable" },
  "strictKnownMarketplaces": []
}
```

Two keys. The file next to it, `settings-strict.json`, has about twenty, nested four levels deep.
Same format. Same program reads both.

That is the lesson: **treat every key as optional and merge whatever you find on top of your
defaults.** If your reader insisted on all twenty keys it would crash on the four-line file. Your
`loadConfig()` follows this rule today.

One extra detail worth thirty seconds. The strict file contains `"httpProxyPort": null`. In JSON,
writing `null` is how you say "this setting exists and it is turned off". So in your reader, an
explicit `null` has to behave exactly like a key that was never there. Round 5 of the worked
example is the bug you get when it does not.

For code style, `../claude-code/mods/` is the reference. Copy two habits from it: one short comment
above every export, and `strict` turned on in `tsconfig.json`.

---

## Anthropic to OpenAI translation

Some background you need before this table makes sense.

There is no single standard for "talk to an AI model". Anthropic, who make Claude, have their own
request format. OpenAI have a different one, and because they were first, their format became the
one everybody copies.

**OpenRouter** is a middleman. You send it an OpenAI-shaped request, it forwards your request to
whichever of several hundred models you named, and it sends the reply back in OpenAI shape. One
account, one key, one format, many models. That is why shrek uses it, and why the whole project
costs under $2.

The course you are following is written against Anthropic's format. shrek is written against
OpenAI's. So every chapter needs translating, and the plan keeps a running table of the
differences. Most of the table is about message shapes, and none of that matters yet because
nothing sends a message in Phase 0. What matters today is how you build the client object:

| The course (Anthropic) | shrek (OpenRouter, OpenAI shape) |
|---|---|
| `Anthropic()` with no arguments. It finds the key in your environment by itself | `new OpenAI({ apiKey, baseURL })`, with both values passed in explicitly |
| always talks to `api.anthropic.com` | talks to `https://openrouter.ai/api/v1`, and that has to be changeable |
| `client.messages.create(...)` | `client.chat.completions.create(...)` |
| model names like `claude-sonnet-4-5` | names like `vendor/model`, where a `:free` on the end is part of the name |

**The mistake this phase is designed to prevent.** The `openai` package will quietly read
`process.env.OPENAI_API_KEY` if you do not pass `apiKey` yourself. If you have ever touched an
OpenAI project on this machine, that variable is probably still sitting in your shell. Leave out
`apiKey` and everything looks fine, your `--version` says the key is fine, and then every single
request in Phase 1 fails with `401 No auth credentials found` from OpenRouter. You will spend an
hour looking at the wrong file.

Two defences, both built today. Always pass `apiKey` explicitly. And make the `key:` line in
`--version` report shrek's own config, never whether the client object got created.

---

## Background

### Why config is layered

Your React apps already do a simpler version of this. You put the API URL in `.env`, read it once,
and pass it down as props. You do not call `process.env` inside every component. Same idea here,
same reason.

shrek needs a model name, a key, a base URL and a debug flag. Each one can come from three places:

- A **default** written in the source, so a fresh clone runs with zero setup.
- A **file** at `~/.shrek/config.json`, so your preference survives across every project and every
  terminal window.
- An **environment variable**, so you can override one single run without editing anything.

When two of them disagree, the order is environment, then file, then default. The reason is how
hard each is to change. An environment variable is the easiest thing to set and the easiest to
undo, so it wins. A default compiled into the source is the hardest to change, so it loses. Order
by cost of change and the override you grab in a hurry is the one that takes effect.

The sloppy version is writing `process.env.SHREK_MODEL || 'some-default'` wherever you happen to
need it. That breaks in three ways. You cannot test it without changing your real environment. You
cannot print what is currently active, because no single place knows. And the defaults drift apart,
so two places disagree and you get a bug that only appears on a machine where the variable is not
set.

One function, called once at startup, returning a frozen object that everything else receives as an
argument. This pays off in Phase 9, where a sub-agent runs on a different model from its parent.
That is easy only because the model arrives as a value you can change, not as an environment read
buried inside the loop.

### Why the model list has prices in it

It could be one line: `export const MODEL = "..."`. Three later phases need more than that.

Phase 7 shows you what the session cost. To do that it needs dollars per token for the model that
actually ran. Phase 16 runs long tool chains, and free models are rate limited and will start
refusing you, so switching models has to cost one environment variable and not an edit in four
files. Phase 11 shortens the conversation when it gets close to filling the model's memory, so it
needs that memory size as a number.

Prices are stored **per token**, not per million tokens. Pricing pages quote per million, so the
division happens once, in the one place the table is built. Store per million and you end up
converting units at every call site, and one of those will eventually be wrong by a factor of a
million. A cost readout that is wrong by a million still looks like a plausible number, which is
why nobody catches it.

### Why a folder path becomes a filename

shrek saves one conversation log per project. A project is identified by the folder you ran it in,
which is a path like `/Users/youruser/repo/shrek-code`. You cannot use that as a folder name, because
slashes separate folders.

Real Claude Code flattens it. Look on your own machine:

```sh
ls ~/.claude/projects/
```

You will see names like `-Users-youruser-Desktop-repo-shrek-code`. Every run of characters
that is not a letter or digit became a single `-`. The leading slash became the leading `-`. shrek
copies this rule exactly, so the two tools' folders sit next to each other and you can read both.

It is lossy. `/a/b-c` and `/a/b/c` both flatten to `-a-b-c`, so two different projects would share
a folder. You could fix it by sticking a hash of the real path on the end, which also destroys the
only good thing about the scheme, which is that you can read the name and know which project it is.
Real Claude Code made the same trade. Make it knowingly.

### Why Ink gets installed when nothing is drawn

**Ink is React for the terminal.** Same React you know, same components, same hooks. Instead of
`<div>` and `<span>` rendering to a browser, you write `<Box>` and `<Text>` and it renders to
characters in your terminal. Real Claude Code is built with it, and so is shrek's UI in Phase 3.

Nothing draws in Phase 0. Ink and the `jsx` setting in `tsconfig.json` still go in today, because a
JSX setup that has never compiled a single `.tsx` file is a setup you have not actually tested.
Step 8 compiles one throwaway component to prove it works, then deletes it. Better to find a broken
`tsconfig.json` now than in Phase 3 while you are also learning Ink.

---

## Worked example

Work out the value of one setting, `model`, by hand, before you write `loadConfig()`. Cover the
answers and guess each round first.

The three layers, highest priority first:

```
env       the SHREK_MODEL environment variable
file      ~/.shrek/config.json, the "model" key
default   "nvidia/nemotron-3-super-120b-a12b:free", written in the source
```

and the line you are about to write:

```ts
model: envStr('SHREK_MODEL') ?? pick(file.model) ?? DEFAULTS.model
```

`??` is the nullish coalescing operator. `a ?? b` means "use `a`, unless `a` is `null` or
`undefined`, in which case use `b`". Note that it is different from `||`, which also falls through
on `0`, `""` and `false`. That difference is the whole point of round 4, and
[TS-8](./ts/phase-0.md#ts-8) has what each one does to the types.

### Round 1: you just cloned the repo. No file, no environment variable.

<details><summary>Guess, then open</summary>

The default, `nvidia/nemotron-3-super-120b-a12b:free`.

Reading a config file that does not exist returns `{}` instead of throwing. A missing config file is
what a first run looks like, not an error. Only a file that exists and cannot be parsed is an error.
</details>

### Round 2: the file says `{"model": "z-ai/glm-4.7-flash"}`. No environment variable.

<details><summary>Guess, then open</summary>

`z-ai/glm-4.7-flash`. The default is still there. It just loses.
</details>

### Round 3: same file, and you also run `export SHREK_MODEL=qwen/qwen3.8-flash`.

<details><summary>Guess, then open</summary>

`qwen/qwen3.8-flash`. The environment beats the file.

This is the case the Phase 0 test checks, and it is how you will escape a rate-limited free model in
Phase 16 without touching any code.
</details>

### Round 4: same file, but you run `export SHREK_MODEL=` with nothing after the `=`.

Guess the winner. Then guess what happens on the first API call in Phase 1.

<details><summary>Open</summary>

The environment wins, with the value `""`.

`??` only falls through on `null` and `undefined`. An empty string is neither of those, so it counts
as a real value and it wins. `--version` prints `model: ` with nothing after it, which is very easy
to skim past. Then Phase 1 sends `{"model": ""}` to OpenRouter and gets back a 400 about a field you
never deliberately set.

And `export SHREK_MODEL=` is not a strange thing to type. It is what you do when you mean "turn the
override off". It is also what a CI config produces from a variable declared with no value.

Fix it with a helper, not by switching to `||`. For anything read from the environment, empty means
absent:

```ts
function envStr(name: string): string | undefined {
  const value = process.env[name]?.trim()
  return value ? value : undefined
}
```

Trim as well as check, because `SHREK_MODEL=" "` happens. The price is that no shrek setting can
ever have a meaningful empty-string value. Worth it.
</details>

### Round 5: the file says `{"model": null}`. No environment variable.

Same question. Then think back to `"httpProxyPort": null` in the strict settings file.

<details><summary>Open</summary>

The default wins, if you use `??`. `??` handles `null` correctly all by itself.

The trap is the merge you might reach for instead, because it looks so clean:

```ts
const config = { ...DEFAULTS, ...fileConfig }
```

Spread copies any key that is **present**, and `"model": null` is present. So your default gets
overwritten with `null`, and `null` travels all the way into the request body.

So `pick` is the file-side twin of `envStr`. It throws out `null`, non-strings and blanks in one
place:

```ts
function pick(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}
```
</details>

Two rules cover every square of that grid. Empty environment variables count as absent. Null file
values count as absent.

---

## Your task

Eleven steps. Each one runs on its own.

### 1. Install Bun

**Why.** Bun is a JavaScript runtime, the same job Node does. Three reasons shrek uses it. It runs
`.ts` and `.tsx` files directly with no build step, so there is no bundler to configure. It reads
`.env` by itself, so there is no `dotenv` package. And `bun test` is the test runner from Phase 2
onward. I checked, and it is not installed on this machine yet.

```sh
curl -fsSL https://bun.sh/install | bash
exec $SHELL -l
bun --version
```

Expect 1.3 or later.

### 2. package.json

**Why.** Same file you already know from React projects. The one new part is `bin`.

```json
{
  "name": "shrek-code",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "bin": { "shrek": "./bin/shrek.ts" },
  "scripts": {
    "dev": "bun run bin/shrek.ts",
    "test": "bun test",
    "typecheck": "bunx tsc --noEmit"
  }
}
```

`"bin"` is what makes a package installable as a terminal command. Later, `bun link` reads it and
puts a `shrek` command on your PATH so you can type `shrek` from anywhere. Until then you type
`bun run bin/shrek.ts`.

Now let Bun write the dependency lists, so the versions recorded are the ones actually installed:

```sh
bun add openai ink react ink-text-input zod zod-to-json-schema
bun add -d @types/bun @types/react
```

`openai` is the client library. `ink` and `react` are the terminal UI for Phase 3. `zod` describes
the shape of tool inputs in Phase 2.

### 3. tsconfig.json

**Why.** TypeScript settings. Mostly ordinary, with two lines that matter.

```json
{
  "compilerOptions": {
    "target": "es2023",
    "lib": ["es2023"],
    "module": "esnext",
    "moduleResolution": "bundler",
    "types": ["bun"],
    "jsx": "react-jsx",
    "jsxImportSource": "react",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "verbatimModuleSyntax": true,
    "resolveJsonModule": true,
    "noEmit": true,
    "skipLibCheck": true
  },
  "include": ["bin", "src", "tests"]
}
```

*TypeScript here: [`strict` and `noUncheckedIndexedAccess`](./ts/phase-0.md#ts-15) ·
[`verbatimModuleSyntax`](./ts/phase-0.md#ts-14).*

`"jsx": "react-jsx"` is the modern JSX mode, the one where you do not have to `import React` at the
top of every component. `noEmit` is honest here, because Bun runs your TypeScript directly and
`tsc` is only ever a checker in this project. `resolveJsonModule` is what lets `bin/shrek.ts` read
the version number out of `package.json` instead of keeping a second copy that drifts.

If `tsc` complains about `Response` or `fetch` from inside the `openai` types, add `"dom"` to
`lib`. Try without it first.

### 4. .env.example, and check what git ignores

**Why.** Your API key is a password. If it lands in a git commit, it is in the history forever, and
deleting the file later does not remove it.

```sh
printf 'OPENROUTER_API_KEY=\n' > .env.example
git check-ignore -v .env .env.local
```

All four should print the rule that matches them. `.env.example` is committed **with an empty
value** so anyone cloning the repo learns the variable's name and nothing else.

Now put your real key in `.env` and prove git is ignoring it:

```sh
printf 'OPENROUTER_API_KEY=sk-or-v1-...\n' > .env
git status --short
```

`.env` must not appear in that output. If it does, stop and fix `.gitignore` before typing anything
else.

### 5. src/paths.ts

**Why.** This file answers questions 3 and 4 from the top: where conversations go and where logs
go. Every other file that touches the disk asks this one for the path. That is deliberate, because
in Phase 2 your tests need to redirect all of it to a temp folder, and they can only do that if
there is one place to redirect.

```ts
import { mkdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

/** Root of per-user state. `~/.shrek`, or `$SHREK_STATE_DIR` when set. */
export function stateDir(): string {
  const override = process.env.SHREK_STATE_DIR?.trim()
  return override ? override : join(homedir(), '.shrek')
}

/** `~/.shrek/config.json`, the file layer that `loadConfig` reads. */
export function configPath(): string {
  return join(stateDir(), 'config.json')
}

/** `~/.shrek/logs`, where the Phase 1 debug logger writes. */
export function logsDir(): string {
  return join(stateDir(), 'logs')
}

/**
 * A folder path squashed into one safe folder name. Every run of characters
 * that is not a letter or digit becomes one `-`, so `/Users/youruser/repo/shrek`
 * becomes `-Users-youruser-repo-shrek`. Same rule real Claude Code uses.
 * Lossy: `/a/b-c` and `/a/b/c` collide.
 */
export function slugifyCwd(cwd: string): string {
  return cwd.replace(/[^A-Za-z0-9]+/g, '-')
}

/** This project's conversation folder. Phase 1 writes logs here. */
export function projectDir(cwd: string = process.cwd()): string {
  return join(stateDir(), 'projects', slugifyCwd(cwd))
}

/** Create the folders. Safe to call on every single start. */
export async function ensureStateDir(cwd: string = process.cwd()): Promise<string> {
  await mkdir(logsDir(), { recursive: true })
  await mkdir(projectDir(cwd), { recursive: true })
  return stateDir()
}
```

*TypeScript here: [annotations](./ts/phase-0.md#ts-2) · [`?.`](./ts/phase-0.md#ts-8) ·
[`async` and `Promise<T>`](./ts/phase-0.md#ts-13).*

Three things to notice.

These are functions, not constants. If you wrote `export const STATE_DIR = ...` the value would be
locked in the moment the file is imported, and a test could never point shrek somewhere else.
Computing it on each call is what makes `SHREK_STATE_DIR` work.

`homedir()` comes from `node:os`, not `process.env.HOME`. `HOME` is missing in some environments,
including parts of macOS's background job system and several CI runners.

`mkdir` with `recursive: true` creates missing parents and does not complain if the folder is
already there, so there is no "check then create" dance.

### 6. src/llm/models.ts

**Why.** The list of AI models shrek can talk to. Phase 7 reads the prices out of here to show you
what a session cost. Phase 11 reads the context sizes to decide when the conversation is getting
too long. And when a free model starts rate limiting you in Phase 16, this is the file that makes
switching a one-word change.

```ts
/** One row: what to send, how much it can hold, what it costs. */
export type ModelInfo = {
  id: string
  /** How many tokens of conversation it can hold at once. */
  context: number
  /** USD per input token. */
  inputPerToken: number
  /** USD per output token. */
  outputPerToken: number
  /** Free ids end in `:free` and are rate limited. */
  free: boolean
}

/** The default. Free, can use tools, good enough for Phases 0 to 15. */
export const DEFAULT_MODEL = 'nvidia/nemotron-3-super-120b-a12b:free'

/** [id, context tokens, USD per 1M in, USD per 1M out], as the pricing page quotes it. */
const TABLE: [string, number, number, number][] = [
  ['qwen/qwen3.8-27b:free', 262_144, 0, 0],
  ['qwen/qwen3-coder-30b-a3b-instruct', 262_144, 0.07, 0.28],
  ['z-ai/glm-4.7-flash', 200_000, 0.06, 0.4],
  ['qwen/qwen3.8-flash', 1_000_000, 0.15, 0.47],
  ['nvidia/nemotron-3-super-120b-a12b:free', 262_144, 0, 0],
  ['google/gemma-4-31b-it:free', 262_144, 0, 0],
  ['cohere/north-mini-code:free', 256_000, 0, 0],
  ['poolside/laguna-s-2.1:free', 262_144, 0, 0],
]

export const MODELS: Record<string, ModelInfo> = Object.fromEntries(
  TABLE.map(([id, context, inPerM, outPerM]) => [
    id,
    {
      id,
      context,
      inputPerToken: inPerM / 1_000_000,
      outputPerToken: outPerM / 1_000_000,
      free: id.endsWith(':free'),
    },
  ]),
)

/** Free ids to switch to when the default starts refusing you. */
export const FREE_FALLBACKS: readonly string[] = Object.values(MODELS)
  .filter((m) => m.free && m.id !== DEFAULT_MODEL)
  .map((m) => m.id)

/** A row, or undefined for an id shrek has never heard of. */
export function lookupModel(id: string): ModelInfo | undefined {
  return MODELS[id]
}

/** USD for one request. Phase 7 calls this with the numbers the API returns. */
export function costOf(info: ModelInfo, inputTokens: number, outputTokens: number): number {
  return inputTokens * info.inputPerToken + outputTokens * info.outputPerToken
}
```

*TypeScript here: [`type` aliases](./ts/phase-0.md#ts-3) ·
[tuples and `readonly`](./ts/phase-0.md#ts-10) · [`Record<K, V>`](./ts/phase-0.md#ts-9) ·
[why `lookupModel` returns `| undefined`](./ts/phase-0.md#ts-15).*

A **token** is roughly three quarters of a word. Models are billed per token and can only hold so
many at once, which is what `context` measures. 262,144 tokens is around 200,000 words.

**The underscores in `262_144` and `1_000_000` do nothing.** They are a thousands separator you are
allowed to type in source code, and the parser throws them away, so `1_000_000 === 1000000`. They
exist because `1000000` and `10000000` look identical at a glance and `1_000_000` and `10_000_000`
do not. Use them in any long number from here on.

The table keeps the dollars-per-million numbers you can check against OpenRouter's website, and the
division to per-token happens in exactly one place.

`lookupModel` returns `undefined` for an unknown id instead of throwing, and `--version` will say
"unknown to registry" while still using it. The alternative, rejecting anything not in the table,
gives a nicer error for a typo but turns this file into a gate. OpenRouter adds and removes models
every few weeks, and a model added on Tuesday should work on Tuesday.

### 7. src/config.ts

**Why.** This file answers questions 1 and 2: which model, and which key. It is the only place in
the entire project that reads `process.env`. Everything else takes the finished object as an
argument, the same way a React component takes props instead of reaching into global state.

```ts
import { configPath } from './paths'
import { DEFAULT_MODEL } from './llm/models'

/** Worked out once at startup, then passed down by argument. */
export type Config = {
  model: string
  /** undefined when nothing supplied a key. */
  apiKey: string | undefined
  baseURL: string
  debug: boolean
}

/** Layer 1. What a fresh clone with no file and no env vars gets. */
export const DEFAULTS = {
  model: DEFAULT_MODEL,
  baseURL: 'https://openrouter.ai/api/v1',
  debug: false,
} as const

/** An env value, where empty or blank counts as not set. Round 4. */
function envStr(name: string): string | undefined {
  const value = process.env[name]?.trim()
  return value ? value : undefined
}

/** An env on/off switch. `1`, `true` and `yes` mean on. */
function envFlag(name: string): boolean | undefined {
  const value = envStr(name)?.toLowerCase()
  if (value === undefined) return undefined
  return value === '1' || value === 'true' || value === 'yes'
}

/** A file value, where null, blank and non-strings all count as not set. Round 5. */
function pick(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

/** Layer 2. Every key optional, exactly like the settings examples. */
type FileConfig = { model?: unknown; apiKey?: unknown; baseURL?: unknown; debug?: unknown }

/**
 * Read `~/.shrek/config.json`. Missing is the normal first run and gives `{}`.
 * A file that exists and will not parse is an error that names the path,
 * because `JSON.parse` tells you what broke and never which file it was in.
 */
async function readFileLayer(path: string): Promise<FileConfig> {
  const file = Bun.file(path)
  if (!(await file.exists())) return {}

  let parsed: unknown
  try {
    parsed = JSON.parse(await file.text())
  } catch (error) {
    throw new Error(`${path}: ${error instanceof Error ? error.message : String(error)}`)
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(`${path}: expected a JSON object`)
  }
  return parsed as FileConfig
}

/** Work out every setting once. Env beats file beats default. */
export async function loadConfig(): Promise<Readonly<Config>> {
  const file = await readFileLayer(configPath())

  return Object.freeze({
    model: envStr('SHREK_MODEL') ?? pick(file.model) ?? DEFAULTS.model,
    apiKey: envStr('OPENROUTER_API_KEY') ?? pick(file.apiKey),
    baseURL: envStr('SHREK_BASE_URL') ?? pick(file.baseURL) ?? DEFAULTS.baseURL,
    debug:
      envFlag('SHREK_DEBUG') ??
      (typeof file.debug === 'boolean' ? file.debug : undefined) ??
      DEFAULTS.debug,
  })
}
```

*TypeScript here: [`string | undefined`](./ts/phase-0.md#ts-4) ·
[optional properties](./ts/phase-0.md#ts-5) · [`unknown`](./ts/phase-0.md#ts-6) ·
[narrowing](./ts/phase-0.md#ts-7) · [`as const`](./ts/phase-0.md#ts-11) ·
[`as`](./ts/phase-0.md#ts-12) · [`Readonly<T>`](./ts/phase-0.md#ts-9).*

Those four lines are stacked on purpose. Read down the column and you see the precedence. Read
across a row and you see every source for one setting. When Phase 5 adds a setting, it goes in this
list and nowhere else.

`apiKey` is the odd one out. It has no default, so its chain is two links instead of three and its
type is `string | undefined`. That is exactly why `--version` can honestly report a missing key
rather than inventing one.

### 8. Prove the JSX setup works, then delete it

**Why.** Thirty seconds now to avoid an hour in Phase 3.

```sh
mkdir -p src/ui
cat > src/ui/Smoke.tsx <<'EOF'
import { Text, render } from 'ink'

const app = render(<Text>ink is wired</Text>)
app.unmount()
await app.waitUntilExit()
EOF

bun run src/ui/Smoke.tsx
bun run typecheck
rm src/ui/Smoke.tsx
```

Expect `ink is wired` printed, and a clean typecheck. If it fails, the cause is almost always `jsx`
or `jsxImportSource` in `tsconfig.json`, or a missing `@types/react`.

### 9. src/llm/client.ts

**Why.** This is the object that actually talks to the AI. Nothing calls it in Phase 0. It is
written now so Phase 1 adds one thing, the loop, rather than two.

```ts
import OpenAI from 'openai'
import type { Config } from '../config'

/** Whether shrek has a key. Read from config, never from the SDK. */
export function keyStatus(config: Config): 'ok' | 'missing' {
  return config.apiKey ? 'ok' : 'missing'
}

/**
 * An OpenAI-shaped client pointed at OpenRouter. `apiKey` is passed in on
 * purpose: leave it out and the SDK reads `OPENAI_API_KEY`, builds without
 * complaining, and then 401s on every request.
 */
export function createClient(config: Config): OpenAI {
  if (!config.apiKey) {
    throw new Error(
      'no OpenRouter key. Set OPENROUTER_API_KEY in .env, or "apiKey" in ~/.shrek/config.json',
    )
  }

  return new OpenAI({
    apiKey: config.apiKey,
    baseURL: config.baseURL,
    defaultHeaders: { 'X-Title': 'shrek-code' },
  })
}
```

*TypeScript here: [literal union return types](./ts/phase-0.md#ts-4) ·
[`import type`](./ts/phase-0.md#ts-14).*

Notice where the error lives. Throwing on a missing key is correct **here** and would be wrong in
`loadConfig`, because `--version` has to work on a machine with no key at all. Working out the
config never fails over a missing key. Using it does.

### 10. bin/shrek.ts

**Why.** The entry point, the `index.js` of this project. It is the only file allowed to print to
the screen or decide the exit code. Everything above it computes values and returns them.

```ts
#!/usr/bin/env bun
import pkg from '../package.json'
import { loadConfig, type Config } from '../src/config'
import { keyStatus } from '../src/llm/client'
import { lookupModel } from '../src/llm/models'
import { ensureStateDir, stateDir } from '../src/paths'

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

async function main(argv: string[]): Promise<number> {
  const config = await loadConfig()
  await ensureStateDir()

  if (argv.includes('--version') || argv.includes('-v')) {
    for (const line of versionLines(config)) console.log(line)
    return 0
  }

  console.error('usage: shrek --version')
  return 1
}

const code = await main(process.argv.slice(2)).catch((error: unknown) => {
  console.error(`shrek: ${error instanceof Error ? error.message : String(error)}`)
  return 1
})

process.exit(code)
```

*TypeScript here: [`import type` and JSON imports](./ts/phase-0.md#ts-14) ·
[`Promise<number>`](./ts/phase-0.md#ts-13) ·
[narrowing `unknown` in a `catch`](./ts/phase-0.md#ts-7).*

Three shapes worth naming.

`main` **returns** an exit code instead of calling `process.exit` itself. So there is one exit in
the file, and one place that turns a thrown error into a single readable line. The user sees
`shrek: /Users/youruser/.shrek/config.json: JSON Parse error: ...` instead of a stack trace. An exit code
of 0 means success and anything else means failure, which is how shell scripts and CI check whether
your command worked.

`ensureStateDir()` runs before the flag check, so `--version` is the thing that creates `~/.shrek`
on a first run. That is why printing the state folder is worth a line: it reports a folder that now
definitely exists.

`versionLines` returns an array of strings instead of printing them. Phase 3 renders these same four
facts inside an Ink component, and a function that returns strings can be used by both.

### 11. Commit

```sh
git add -A
git diff --cached | grep -iE 'sk-or-|api[_-]?key'
```

That grep will find `.env.example`, which literally contains the text `OPENROUTER_API_KEY=`. Read
the match, confirm it is only that one empty line, then:

```sh
git commit -m "phase 0: project setup"
```

---

## Test

```sh
bun run bin/shrek.ts --version
```

```
shrek 0.1.0
model: nvidia/nemotron-3-super-120b-a12b:free (262k ctx, free)
key: ok
state: /Users/youruser/.shrek
```

Now the override, which is round 3 of the worked example actually running:

```sh
SHREK_MODEL=qwen/qwen3.8-flash bun run bin/shrek.ts --version
```

Only the model line changes, to `qwen/qwen3.8-flash (1000k ctx, paid)`. Exit code is 0 both times,
which you can check with `echo $?`.

Then confirm the folders exist and the key is not tracked by git:

```sh
ls ~/.shrek ~/.shrek/projects
git ls-files | grep '^\.env$' || echo "not tracked"
```

You should see `logs/` and `projects/`, with `projects/` holding
`-Users-youruser-Desktop-repo-shrek-code`, empty until Phase 1 writes to it. The grep prints
`not tracked`. (`git ls-files` lists what git is really tracking, which is the question that
matters. `git status` only tells you what changed.)

### Deliberate failure: a broken config file

```sh
printf '{"model": "z-ai/glm-4.7-flash",}\n' > ~/.shrek/config.json
bun run bin/shrek.ts --version; echo "exit $?"
```

The comma before the `}` is the point. JSON does not allow it. Correct failure:

```
shrek: /Users/youruser/.shrek/config.json: JSON Parse error: Expected '"'
exit 1
```

The exact parser wording changes between Bun versions. What must be there is the full path and an
exit code of 1.

- A stack trace instead means your `try`/`catch` in `readFileLayer` is missing.
- A normal `--version` on the default model means you are swallowing the error, which is worse than
  crashing, because it silently ignores the file you just edited.

Fix the file and watch layer 2 win, which is round 2 running:

```sh
printf '{"model": "z-ai/glm-4.7-flash"}\n' > ~/.shrek/config.json
bun run bin/shrek.ts --version
rm ~/.shrek/config.json
```

### Second failure: no key

```sh
env -u OPENROUTER_API_KEY bun run bin/shrek.ts --version; echo "exit $?"
```

Expect `key: missing` and `exit 0`.

Exit 0 is deliberate. `--version` is a diagnostic, and a diagnostic that refuses to run when
something is wrong is useless at exactly the moment you need it. The error belongs in
`createClient`, and you will meet it in Phase 1.

If this prints `key: ok`, your `.env` file beat the `env -u`. Try `mv .env .env.off`, rerun, then
move it back.

---

## Notes and gotchas

**Bun loads `.env` by itself.** No `dotenv` import, no `--env-file` flag. Variables already set in
your shell beat the file, which is why the test above uses `env -u` rather than setting an empty
value.

**The `:free` on the end is part of the model name.** `qwen/qwen3.8-27b` and
`qwen/qwen3.8-27b:free` are two different entries at two different prices. Dropping five characters
moves you from free to billed, with no warning.

**Model ids get retired.** If Phase 1 comes back with `404 No endpoints found for <id>`, the model
is gone, not misspelled. Run
`curl -s https://openrouter.ai/api/v1/models | grep -o '"id":"[^"]*free"'` and update the table.
One line to fix, which is the reason the table exists.

**Conversation folders start with a hyphen.** `rm -rf -Users-you-repo-shrek-code` fails, because
`rm` reads the leading `-` as a flag. Use `rm -rf -- <folder>`. This will catch you in Phase 7.

**Never print any part of the key.** Not a prefix, not even the length. `--version` output is the
first thing anybody pastes into a bug report.

**`SHREK_STATE_DIR` is what makes tests possible.** It works only because `stateDir()` reads the
environment every time it is called. Turn those functions into constants and your Phase 2 tests
start writing into your real home folder.

**Zod might make one dependency unnecessary.** If `bun add zod` installed version 4, it has
`z.toJSONSchema` built in and `zod-to-json-schema` is redundant. Do not act on that now. Phase 2 is
where tool schemas get generated, and that is where you check which version you have.

---

## Recap

`~/.shrek` exists, with `logs/` and `projects/<slug>/` waiting for Phase 1 to write into them, named
by the same rule real Claude Code uses.

`loadConfig()` works out four settings from three sources, with one rule for empty environment
values and one for null file values, and hands back a frozen object that everything else receives as
an argument.

`src/llm/models.ts` lists every model shrek can reach, with per-token prices Phase 7 will read and
context sizes Phase 11 will read. Switching models is one environment variable.

`createClient` builds the OpenRouter client with the key passed in explicitly, and `--version`
prints the four facts you will check first for the next twenty phases.

Three questions to check you got it.

1. The file says `{"model": null}` and your shell has `SHREK_MODEL=" "`. Which layer wins, and which
   of the two guard functions catches each of those two values?

2. Prices are stored per token, not per million. Name the bug the per-million version causes, say
   where in the code it would show up, and say why nobody would catch it in review.

3. `--version` exits 0 when the key is missing, but `createClient` throws when the key is missing.
   Both are correct. What is the general rule?
