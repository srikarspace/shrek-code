# shrek-code

Build your own AI coding agent from scratch, in TypeScript and Bun, one phase at a time. Every phase
is a written lesson you type the code from yourself, so by the end you can say what each mechanism
does and why it exists.

**Status.** Phases 0 and 1a are done, which is about two hours of work and a genuinely useful agent
at the end of it. Phase 1b is next, and twenty more are planned and listed below.

## What you have after the phases that exist

A coding agent you can run on a real repo:

```sh
$ bun run bin/shrek.ts -p "how many .ts files are in this repo?"
$ find . -name '*.ts' -not -path './node_modules/*' | wc -l
There are 10 TypeScript files in this repo.
```

It asks a model what to do, runs the shell commands the model asks for, feeds the output back, and
keeps going until the model has an answer. Commands go to stderr and the answer to stdout, so you can
pipe it. A command that fails is data the model recovers from rather than a crash.

It also forgets everything the moment it exits, which is what phase 1b fixes. No user interface yet,
no permission prompt, no streaming either. Those are phases 3, 4 and 6.

## Who this is for

You can build React apps and you know JavaScript, HTML and CSS. You are learning TypeScript as you
go and you are not fluent in it. No backend, terminal or LLM API experience is assumed, and every
term is defined the first time it appears, including the ones that feel too obvious to define.

You need:

- [Bun](https://bun.sh) 1.2 or later
- a bash shell, so macOS or Linux
- an [OpenRouter](https://openrouter.ai) API key

Total cost for the whole project is under $2. The default model is free, so you can do the early
phases for nothing.

## Start here

```sh
git clone git@github.com:srikarspace/shrek-code.git
cd shrek-code
bun install
cp .env.example .env     # then paste your OpenRouter key into it
```

Now open [`learn/phase-0.md`](./learn/phase-0.md) and work through it.

You type every line of code yourself. That is the whole method, and reading the documents without
typing teaches you much less than you would expect. `src/` holds the finished code up to phase 1a if
you want something to compare against when a file will not compile.

## How a phase works

Each phase is one sitting of about an hour, and comes as two files.

- `learn/phase-N.md` teaches the product: what shrek can do after this phase that it could not do
  before, why each file exists, and the code to type.
- `learn/ts/phase-N.md` teaches the TypeScript, so a construct you already know never interrupts the
  part you came for.

Every phase opens by connecting the files to something the agent will actually do, walks the key idea
by hand in a worked example that asks you to predict before it answers, and ends with a test plus
deliberate failures to reproduce on purpose. The failures are the point. Most of them are mistakes
that look correct while you are typing them.

## Roadmap

| Phase | What it builds | Status |
|---|---|---|
| [0](./learn/phase-0.md) | project setup: config, paths, model registry | done |
| [1a](./learn/phase-1a.md) | the agent loop, the `Tool` shape, the bash tool | done |
| [1b](./learn/phase-1b.md) | JSONL transcript and debug log | next |
| 2 | tool use: read, write, edit, glob, grep | planned |
| 3 | Ink TUI shell | planned |
| 4 | permission: allow, ask and deny | planned |
| 5 | hooks, and the refactor to an event bus | planned |
| 6 | streaming | planned |
| 7 | sessions, usage and cost | planned |
| 8 | TodoWrite | planned |
| 9 | sub-agents | planned |
| 10 | skill loading | planned |
| 11 | context compaction | planned |
| 12 | memory | planned |
| 13 | task system | planned |
| 14 | background tasks | planned |
| 15 | cron scheduler | planned |
| 16 | agent teams | planned |
| 17 | MCP plugin | planned |
| 18 | integrated harness | planned |
| 19 | workflow runtime | planned |
| 20 | goal loop | planned |
| 21 | capstone: the agent builds a React app with the tools you wrote | planned |

## Credits

This project exists because two other repos are public, and both deserve your star.

[**shareAI-lab/learn-claude-code**](https://github.com/shareAI-lab/learn-claude-code) is the
17-chapter course this works through, chapter by chapter. It is Python against the Anthropic Messages
API, one standalone `code.py` per chapter, and it is excellent. Every phase here names the chapter it
came from and says where the TypeScript deliberately diverges.

[**anthropics/claude-code**](https://github.com/anthropics/claude-code) supplies the vocabulary. Its
type declarations and plugin formats are where the event names, the tool shape and the permission
model are borrowed from, so the names you learn here are the names used in production rather than
ones invented for a tutorial.

No code is copied from either. Cloning them as siblings is optional, because each stage document
quotes what it needs. Translating Anthropic-shaped Python into OpenAI-shaped TypeScript is part of
the lesson rather than an accident: shrek talks to OpenRouter, so every chapter gets translated, and
the failures that translation causes are worked through in the documents.

## Not affiliated with Anthropic

An independent learning project. Not affiliated with, endorsed by, or supported by Anthropic or
DreamWorks.

## License

MIT. See [LICENSE](./LICENSE).
