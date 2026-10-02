# Phase 0: project setup

About an hour. Seven small files.

---

## The big picture

shrek is a coding agent that lives in your terminal. When it's finished:

```sh
shrek -p "how many TypeScript files are in this repo?"
```

shrek sends your question to an AI model along with a note: *you can ask me to run commands, read
files and edit files.* The model replies "run `ls src/**/*.ts | wc -l`", shrek runs it, sends back
the output, and the model answers. That loop is the product; you build it in Phase 1.

Phase 0 builds what every later phase reads first. Four answers:

1. Which AI model am I talking to?
2. What is my API key?
3. Where do I save conversations?
4. Where do I write debug logs?

At the end, `shrek --version` prints those four answers and exits. It never contacts the AI, so a
wrong model or missing key shows up in 50ms instead of in the middle of Phase 1.

**OpenRouter** is the service shrek talks to: one key, one request format, hundreds of models,
many of them free. That is why the project costs under $2.

## Files

| File | Job |
|---|---|
| `package.json` | dependencies, scripts, and the `shrek` command name |
| `tsconfig.json` | TypeScript settings |
| `bin/shrek.ts` | the entry point (like `index.js`): read flags, print, exit |
| `src/config.ts` | answers 1 and 2: which model, which key |
| `src/paths.ts` | answers 3 and 4: where files go |
| `src/llm/models.ts` | every model shrek knows, with size and price |
| `src/llm/client.ts` | the object Phase 1 uses to call the model |

TypeScript help for this phase: [`learn/ts/phase-0.md`](./ts/phase-0.md).

---

## Remember this

> Every setting can come from three places, and **the most local one wins**: an environment
> variable beats `~/.shrek/config.json`, which beats the default in the code. All of it is worked
> out once, in one function, and passed down like props. And "empty" counts as "not set", so a
> blank env var or a `null` in the file falls through to the next layer.
>
> **Env beats file beats default. Empty means absent.**

---

## Why

**Layered config.** You already do this in React: read `.env` once, pass values down as props.
The env var is the easiest to change, so it wins for a one-off override. The file holds your
preference. The default lets a fresh project run with zero setup. One function means you can print
what's active and test it without touching your real environment.

**Prices in the model list.** Phase 7 shows what a session cost, Phase 11 needs the context size,
and switching away from a rate-limited free model must be one env var. Prices are stored per token
so the "per million" division happens exactly once.

**A folder path becomes a folder name.** Conversations are saved per project, and a project is the
folder you ran shrek in. `/Users/youruser/repo/your-agent` can't be a folder name, so every run of
non-letters becomes `-`: `-Users-youruser-repo-your-agent`. Real Claude Code uses the same rule.

---

## Worked example

Work out `model` by hand before writing `loadConfig()`:

```ts
model: envStr('SHREK_MODEL') ?? pick(file.model) ?? DEFAULTS.model
```

`a ?? b` means "use `a` unless it is `null` or `undefined`". See [TS-8](./ts/phase-0.md#ts-8).

### Round 1: file says `{"model": "z-ai/glm-4.7-flash"}`, and you run `export SHREK_MODEL=qwen/qwen3.8-flash`

<details><summary>Guess, then open</summary>

`qwen/qwen3.8-flash`. Env beats file. This is how you'll escape a rate-limited model later without
touching code.
</details>

### Round 2: same file, but `export SHREK_MODEL=` with nothing after the `=`

<details><summary>Guess, then open</summary>

With a plain `process.env.SHREK_MODEL ?? ...`, the empty string wins, because `??` only skips
`null` and `undefined`. Phase 1 would send `{"model": ""}` and get a confusing 400.

So `envStr` treats blank as absent:

```ts
function envStr(name: string): string | undefined {
  const value = process.env[name]?.trim()
  return value ? value : undefined
}
```
</details>

### Round 3: the file says `{"model": null}`

<details><summary>Guess, then open</summary>

The tempting merge `{ ...DEFAULTS, ...fileConfig }` copies `model: null` over the default, because
spread copies any key that is present. `pick` is the file-side twin of `envStr`:

```ts
function pick(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}
```
</details>

---

## Your task

Eleven steps.

### 1. Install Bun

**Why.** Bun runs `.ts` files directly (no build step), reads `.env` by itself, and has a test
runner. It does the job Node does.

```sh
curl -fsSL https://bun.sh/install | bash
exec $SHELL -l
bun --version
```

Expect 1.3 or later.

### 2. package.json

**Why.** Same file as in React projects. `bin` is the new part: it names the terminal command.

```json
{
  "name": "shrek",
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

The command is called shrek whatever your folder is called. Then install:

```sh
bun add openai ink react ink-text-input zod zod-to-json-schema
bun add -d @types/bun @types/react
```

`openai` is the client library, `ink` and `react` are Phase 3's terminal UI, `zod` describes tool
inputs from Phase 1.

### 3. tsconfig.json

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

- `noEmit`: Bun runs the TypeScript; `tsc` only checks it.
- `resolveJsonModule` lets `bin/shrek.ts` read the version from `package.json`.

### 4. .env.example, and check what git ignores

**Why.** Your API key is a password. Once in a git commit, it's in the history forever.

```sh
printf 'OPENROUTER_API_KEY=\n' > .env.example
git check-ignore -v .env .env.local
printf 'OPENROUTER_API_KEY=sk-or-v1-...\n' > .env
git status --short
```

`.env` must not appear in `git status`. If it does, fix `.gitignore` before going on.

### 5. src/paths.ts

**Why.** Answers 3 and 4. Every file that touches disk asks this one, so tests can redirect it all
with one variable.

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

- Functions, not constants, so `SHREK_STATE_DIR` is read each call and tests can change it.
- `recursive: true` creates parents and doesn't complain if the folder exists.

### 6. src/llm/models.ts

**Why.** Phase 7 reads prices from here, Phase 11 reads context sizes, and switching models is one
word.

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

- A **token** is about three quarters of a word. Models bill per token and hold a fixed number
  (`context`).
- `1_000_000` is just `1000000` with separators for readability.
- An unknown id still works; OpenRouter adds models weekly.

### 7. src/config.ts

**Why.** Answers 1 and 2, and the only file that reads `process.env`. Everything else gets the
finished object as an argument.

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

- Read down the four lines and you see the precedence; across a row, every source for one setting.
- A missing file is a normal first run. A broken file is an error that names the path.
- `apiKey` has no default, so `--version` can honestly say it's missing.

### 8. Prove the JSX setup works, then delete it

**Why.** Thirty seconds now saves an hour in Phase 3. **Ink** is React for the terminal: `<Box>`
and `<Text>` instead of `<div>` and `<span>`.

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

Expect `ink is wired` and a clean typecheck.

### 9. src/llm/client.ts

**Why.** The object that talks to the model. Written now so Phase 1 only adds the loop.

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

- Always pass `apiKey`. Otherwise the SDK quietly uses a stale `OPENAI_API_KEY` from your shell.
- The missing-key error lives here, not in `loadConfig`, so `--version` still works without a key.

### 10. bin/shrek.ts

**Why.** The entry point. The only file that prints or sets the exit code.

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

- `main` returns an **exit code** (0 = success, anything else = failure) instead of exiting. One
  exit, one place that turns errors into a readable line.
- `versionLines` returns strings, so Phase 3's UI can reuse it.

### 11. Commit

```sh
git add -A
git diff --cached | grep -iE 'sk-or-|api[_-]?key'
git commit -m "phase 0: project setup"
```

The grep finds only `.env.example`'s empty line. Anything else, stop.

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

```sh
SHREK_MODEL=qwen/qwen3.8-flash bun run bin/shrek.ts --version
git ls-files | grep '^\.env$' || echo "not tracked"
```

Only the model line changes, to `qwen/qwen3.8-flash (1000k ctx, paid)`. The grep prints
`not tracked`.

### Deliberate failure: a broken config file

```sh
printf '{"model": "z-ai/glm-4.7-flash",}\n' > ~/.shrek/config.json
bun run bin/shrek.ts --version; echo "exit $?"
```

```
shrek: /Users/youruser/.shrek/config.json: JSON Parse error: Expected '"'
exit 1
```

- A stack trace: the `try`/`catch` in `readFileLayer` is missing.
- A normal `--version`: the error is being swallowed, which silently ignores your file.

Remove the trailing comma to watch the file layer win, then `rm ~/.shrek/config.json`.

---

## Gotchas

- **`:free` is part of the model name.** Drop it and you're on the paid version.
- **Model ids get retired.** `404 No endpoints found` means gone, not misspelled. Update the table.
- **Never print any part of the key**, not even its length.
- **Bun loads `.env` itself.** Shell variables beat the file, which is why tests use `env -u`.

---

## Recap

`~/.shrek` exists with `logs/` and `projects/<slug>/` ready. `loadConfig()` resolves four settings
from three layers into one frozen object. `models.ts` lists every model with prices and sizes, and
`createClient` builds the OpenRouter client with the key passed explicitly.

1. The file says `{"model": null}` and the shell has `SHREK_MODEL=" "`. Which layer wins?
2. `--version` exits 0 with no key, but `createClient` throws. Why are both right?
