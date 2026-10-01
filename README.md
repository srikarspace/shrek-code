# shrek-code

My own AI coding agent, built from scratch in TypeScript and Bun, one phase at a time, as a way to
learn how coding agents work.

**Status.** Phases 0, 1 and 2a are done. Phase 2b is next, and nineteen more are planned below.

## What it does today

```sh
$ bun run bin/shrek.ts -p "in src/a.ts change const to let on the first line only"
Read(src/a.ts)
Edit(src/a.ts)
First line updated to let x = 1.
```

shrek asks a model what to do, runs the tools the model asks for, feeds the results back, and repeats
until the model answers. It has Bash plus Read, Write and Edit, all behind one registry that
validates every call before it runs. Tool lines go to stderr and the answer to stdout, so you can pipe
it. A tool that fails is data the model recovers from rather than a crash. Every message lands in a
transcript on disk, and the raw request and response bodies land in a debug log.

There is no interface, no permission prompt, no streaming and no resume yet. Those are phases 3, 4, 6
and 7.

## Running it

Needs Bun, a bash shell and an [OpenRouter](https://openrouter.ai) API key, set as
`OPENROUTER_API_KEY` in `.env` or as `apiKey` in `~/.shrek/config.json`.

```sh
bun install
bun run bin/shrek.ts -p "your question"
```

## Notes

Each phase has my notes in `learn/`:

- `learn/phase-N.md` covers what the phase builds, why each file exists, and the code.
- `learn/ts/phase-N.md` covers the TypeScript the phase uses.

A phase with more than an hour of work splits into lettered parts, `1a` and `1b`.

## Roadmap

| Phase | Topic | What it builds | Status |
|---|---|---|---|
| 0 | project setup | [config layers, state paths, the model registry](./learn/phase-0.md) | done |
| 1 | agent loop | [a](./learn/phase-1a.md) the loop as a state machine, the `Tool` shape, the bash tool | done |
| | | [b](./learn/phase-1b.md) the JSONL transcript and the debug log | done |
| 2 | tool use | [a](./learn/phase-2a.md) the tool registry, and Read, Write and Edit | done |
| | | [b](./learn/phase-2b.md) Glob and Grep, parallel calls, unit tests | next |
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
| 21 | capstone | the agent builds a React app with the tools I wrote | planned |

## Credits

[**shareAI-lab/learn-claude-code**](https://github.com/shareAI-lab/learn-claude-code) is the
17-chapter course I am working through. It is Python against the Anthropic Messages API, one
standalone `code.py` per chapter. Each phase's notes name the chapter it came from and where the
TypeScript diverges.

[**anthropics/claude-code**](https://github.com/anthropics/claude-code) supplies the vocabulary: the
event names, the tool shape and the permission model come from its type declarations and plugin
formats.

No code is copied from either. shrek talks to OpenRouter, so every chapter gets translated from
Anthropic-shaped Python into OpenAI-shaped TypeScript.

## Not affiliated with Anthropic

A personal learning project. Not affiliated with, endorsed by, or supported by Anthropic or
DreamWorks.

## License

MIT. See [LICENSE](./LICENSE).
