# shrek-code

Build your own AI coding agent from scratch, in TypeScript and Bun, one phase at a time. You type
every line of code yourself.

**Status.** Phases 0 and 1 are done, which is about three hours of work. Phase 2 is next, and twenty
more are planned below.

## What it does today

```sh
$ bun run bin/shrek.ts -p "how many .ts files are in this repo?"
$ find . -name '*.ts' -not -path './node_modules/*' | wc -l
There are 12 TypeScript files in this repo.
```

shrek asks a model what to do, runs the shell commands the model asks for, feeds the output back, and
repeats until the model answers. Commands go to stderr and the answer to stdout, so you can pipe it.
A command that fails is data the model recovers from rather than a crash. Every message lands in a
transcript on disk, and the raw request and response bodies land in a debug log.

There is no interface, no permission prompt, no streaming and no resume yet. Those are phases 3, 4, 6
and 7.

## Start here

You need a bash shell so macOS or Linux, and an [OpenRouter](https://openrouter.ai) API key. The
default model is free and the whole project costs under $2. Phase 0 installs Bun and creates every
other file, including `package.json`.

Do not clone this repo to build in. You write the code yourself, in a project of your own, named
whatever you like:

```sh
mkdir your-agent && cd your-agent
git init
```

Now open [`learn/phase-0.md`](./learn/phase-0.md) and work through it, typing each file into your new
directory as the document reaches it.

The documents assume you can build React apps and know JavaScript, HTML and CSS. They teach
TypeScript as you go and assume no backend, terminal or LLM API experience.

## How a phase works

One phase is one sitting of about an hour and comes as two files.

- `learn/phase-N.md` teaches the product: what shrek can do after this phase that it could not do
  before, why each file exists, and the code to type.
- `learn/ts/phase-N.md` teaches the TypeScript, so a construct you already know never interrupts the
  part you came for.

A phase with more than an hour of work in it splits into lettered parts, `1a` and `1b`, each its own
sitting with its own pair of files.

Every phase walks its key idea by hand before any code, asks you to predict what happens next, and
ends with a test plus failures to reproduce on purpose. The failures are the point, and most of them
are mistakes that look correct while you are typing them. `src/` holds the finished code up to phase
1b. Clone this repo somewhere separate if you want that to diff against when a file of yours will not
compile.

## Roadmap

A phase with lettered parts gets one row per part, and each part has its own status.

| Phase | Topic | What it builds | Status |
|---|---|---|---|
| 0 | project setup | [config layers, state paths, the model registry](./learn/phase-0.md) | done |
| 1 | agent loop | [a](./learn/phase-1a.md) the loop as a state machine, the `Tool` shape, the bash tool | done |
| | | [b](./learn/phase-1b.md) the JSONL transcript and the debug log | done |
| 2 | tool use | read, write, edit, glob and grep, behind one dispatch map | next |
| 3 | TUI | an Ink shell, and the loop as an event stream that drives it | planned |
| 4 | permission | the check between the model asking and the machine doing: allow, ask, deny | planned |
| 5 | hooks | the event bus refactor, and extensions that attach to the loop | planned |
| 6 | streaming | SSE deltas, and tool calls reassembled from fragments | planned |
| 7 | sessions | replaying a transcript into live state, plus token and cost accounting | planned |
| 8 | TodoWrite | making the model write the steps down before it starts | planned |
| 9 | sub-agents | context isolation: a fresh message array, only the final text returns | planned |
| 10 | skills | progressive disclosure, so bodies load only when named | planned |
| 11 | compaction | four ways to make room when the context window fills | planned |
| 12 | memory | what to store, what to drop, and how it gets back into a prompt | planned |
| 13 | tasks | big goals split into small ordered steps kept on disk | planned |
| 14 | background work | slow operations running while the agent keeps going | planned |
| 15 | cron | scheduled runs that nobody starts, and that survive a restart | planned |
| 16 | agent teams | persistent teammates, an async mailbox, atomic claims | planned |
| 17 | MCP | external tools joining the same pool as the native ones | planned |
| 18 | harness | every mechanism so far assembled behind one `engine.create` | planned |
| 19 | workflows | saved step sequences with resumable state | planned |
| 20 | goal loop | a stated goal, and an evaluator that decides when to stop | planned |
| 21 | capstone | the agent builds a React app with the tools you wrote | planned |

## Credits

Two public repos made this possible, and both deserve your star.

[**shareAI-lab/learn-claude-code**](https://github.com/shareAI-lab/learn-claude-code) is the
17-chapter course this works through, chapter by chapter. It is Python against the Anthropic Messages
API, one standalone `code.py` per chapter. Every phase here names the chapter it came from and says
where the TypeScript diverges.

[**anthropics/claude-code**](https://github.com/anthropics/claude-code) supplies the vocabulary. The
event names, the tool shape and the permission model come from its type declarations and plugin
formats, so the names you learn here are the ones used in production rather than ones invented for a
tutorial.

No code is copied from either, and you do not need to clone them, because each stage document quotes
what it needs. shrek talks to OpenRouter, so every chapter gets translated from Anthropic-shaped
Python into OpenAI-shaped TypeScript, and the failures that translation causes are worked through in
the documents.

## Not affiliated with Anthropic

An independent learning project. Not affiliated with, endorsed by, or supported by Anthropic or
DreamWorks.

## License

MIT. See [LICENSE](./LICENSE).
