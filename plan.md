# shrek-code

Build your own Claude Code.

## Context

shrek is a terminal coding agent I write from scratch in TypeScript and Bun, running on OpenRouter
so the whole project costs under $2. One mechanism per phase: the loop, tools, a UI, permissions,
hooks, and so on up to agent teams and a goal loop. The phase order follows the 17 chapters of
`../learn-claude-code/` (s01 to s17), and names are borrowed from real Claude Code where that helps.
The last phase points the finished agent at a real task: build a React app using only the tools I
wrote.

The point of each phase is that I can say two things when it is done: what we added, and what it
changes in the bigger picture of shrek.

---

## How this plan is used

I write all the code. A tutor agent writes two markdown files per phase and nothing else.

1. Paste the tutor contract plus the phase's prompt into a fresh session. It writes
   `learn/phase-N.md` and `learn/ts/phase-N.md`, then stops.
2. I type the code from the doc. The tutor answers questions and reads my pasted errors. It never
   edits, builds or tests for me.

### Tutor contract (paste at the top of every phase prompt)

```
You are a tutor, not an implementer. Read plan.md first.

Output only learn/phase-N.md and learn/ts/phase-N.md (one pair per lettered part, e.g. 2a and
2b). Do not touch any other file. Write both, then stop. While I work you may read my files and
my pasted output, but never fix, build or test for me.

Who I am. New to building software. I know React, HTML, CSS and JavaScript. I am learning
TypeScript and am not fluent. Define any backend, terminal or LLM term the first time it shows
up. React analogies help. Short sentences, one idea each.

Keep it small. About an hour, 400 to 550 lines, most of it code I type. If it cannot fit, split
it into lettered parts. Less prose is better: say what we add, why shrek needs it, and what it
changes in the bigger picture. Skip history, comparisons to other codebases, and API trivia that
does not change the code I type.

Pull out the one idea. Every doc has a "Remember this" box holding the single most important
idea of the phase, in two to four sentences plus a one-line hook I can repeat from memory.

Code blocks are whole files. When a phase changes a file an earlier phase wrote, print the
entire new file so I can paste it over the old one.

Evals. From Phase 3c on, every phase doc has an Eval section: the new case files in evals/cases/
(whole files), the command `bun run eval`, and the table I should see. A phase is done when its
test passes and the whole eval suite, old cases included, meets its threshold.

TypeScript lives in the companion. Never explain syntax inline in learn/phase-N.md. Put one
italic link line after a code block that needs it, pointing at an anchor in learn/ts/phase-N.md.

Prose. No em dashes. Sentence case headings. Plain words.

Placeholders. The repo is public. Home paths are /Users/youruser/..., project paths are
/Users/youruser/repo/your-agent, keys are sk-or-v1-... . Scrub anything I paste before it goes
into a doc. The product is always called shrek (bin/shrek.ts, ~/.shrek).
```

Each phase's prompt below is the delta that follows the contract.

---

## The learn/phase-N.md template

```markdown
# Phase N: <title>

About an hour. <n> files.

## The big picture
Five to ten lines. What shrek could do before this phase, what it can do after, and which later
phases depend on what we add today. One example command if it helps.

## Files
| File | Job |
One row per file created or changed, one-line job each.

## Remember this
> A blockquote box. The single most important idea of the phase in two to four sentences, then a
> bold one-line hook to memorise.

## Why
Three or four short paragraphs, bold lead-in each. Only the reasons that shape the code.

## Worked example
Two or three predict-then-reveal rounds (<details> blocks), only the cases that cause real bugs.

## Your task
Numbered steps. Each opens with one bold "Why." sentence tied to the product, then the full file,
then one to three lines on what to notice. Last step is the commit.

## Test
The command and its expected output. One deliberate failure, with what each wrong outcome means.

## Eval
From Phase 3c on. The new case files, `bun run eval` and its expected table, and what a failing
case usually means.

## Gotchas
Three or four bullets.

## Recap
Three lines on what now exists. Two questions to check understanding.
```

## The learn/ts/phase-N.md template

```markdown
# TypeScript for Phase N

One line: covers the TypeScript this phase introduces; read sideways, one section at a time.

<a id="ts-1"></a>
## TS-1. <construct, named the way I would search for it>
Two or three sentences of plain English, the real line from shrek that uses it, and what it buys
over the simpler version.
```

Rules: explicit `<a id="ts-N"></a>` anchors; examples are real shrek lines, never `Foo`/`Bar`;
three to eight sections, each readable in a minute; link back to earlier companions by anchor
instead of repeating them. The stage doc links in with
`*TypeScript here: [label](./ts/phase-N.md#ts-3).*` right after the code block.

---

## Stack decisions (fixed)

| Choice | Value | Why |
|---|---|---|
| Runtime | Bun 1.3 | Native TypeScript, `Bun.$`, `Bun.Glob`, test runner, no build step |
| Language | TypeScript, ESM | Matches real Claude Code |
| TUI | Ink (React for CLI) plus `ink-text-input` | Component model makes streaming re-renders manageable |
| LLM API | OpenRouter via the `openai` SDK (`baseURL: https://openrouter.ai/api/v1`) | OpenAI-compatible tool calling |
| Schema | Zod 4 with `z.toJSONSchema` | One source of truth per tool: runtime check and the schema the model sees |

CLI binary name: `shrek`.

### Model registry

| Role | Model | Context | Price per M, in / out |
|---|---|---|---|
| Default, P0 through P15 | `qwen/qwen3.8-27b:free` | 262k | $0 |
| Paid fallback (P16, P18, P20, P21) | `qwen/qwen3-coder-30b-a3b-instruct` | 262k | $0.07 / $0.28 |
| Cheaper alternative | `z-ai/glm-4.7-flash` | 200k | $0.06 / $0.40 |
| Cost-math check (P7, one request) | `qwen/qwen3.8-flash` | 1M | $0.15 / $0.47 |

Free fallbacks when rate-limited: `nvidia/nemotron-3-super-120b-a12b:free`,
`google/gemma-4-31b-it:free`, `cohere/north-mini-code:free`, `poolside/laguna-s-2.1:free`.
Switching is one environment variable (`SHREK_MODEL`). Free models struggle with the long chains in
P16, P18 and P20; P21 treats that as the lesson.

---

## State and config layout

```
<project>/.shrek/
├── settings.json           # permissions.allow / ask / deny
├── hooks.json              # event to handler module
├── skills/<name>/SKILL.md  # frontmatter: name, description
├── agents/<name>.md        # frontmatter: name, description, tools, model
├── commands/<name>.md      # $ARGUMENTS
└── memory/                 # P12: *.md plus a MEMORY.md index

~/.shrek/
├── config.json  settings.json  mcp.json  schedule.json
├── projects/<cwd-slug>/<session>.jsonl   # append-only transcripts
├── logs/shrek.log                        # raw wire traffic
└── AGENTS.md                             # optional global instructions
```

`.claude/` is read as a fallback at each path, so real Claude Code skills and agents load unchanged.
Transcripts (every message, replayable) and the debug log (raw requests and responses) are two
separate files, both written from P1.

---

## Git discipline

- `plan.md` is committed and kept truthful. `learn/` and `learn/ts/` are committed with each
  phase's code, and `evals/` with each phase's cases.
- The OpenRouter key lives only in `.env` (gitignored) or the shell. `.env.example` is committed empty.
- End every phase with `git commit -m "phase N: <short title>"`, after its test passes.
- Before each commit, `git diff --cached | grep -iE 'sk-or-|api[_-]?key'` must print nothing.

---

## Target layout (end state)

```
your-agent/
├── package.json  tsconfig.json  .env.example  README.md
├── learn/phase-*.md  learn/ts/phase-*.md
├── bin/shrek.ts                     # entrypoint: flags, one-shot vs TUI
├── src/
│   ├── config.ts  paths.ts  log.ts
│   ├── llm/        client.ts  models.ts  stream.ts
│   ├── engine/     $.ts  bus.ts  next.ts  matchers.ts  events.ts   # P5
│   ├── agent/      loop.ts  events.ts  systemPrompt.ts
│   ├── tools/      types.ts registry.ts guards.ts
│   │               read.ts write.ts edit.ts glob.ts grep.ts bash.ts todo.ts
│   ├── permissions/ policy.ts  store.ts           # P4
│   ├── session/    jsonl.ts  store.ts  usage.ts
│   ├── context/    agentsMd.ts  skills.ts  commands.ts  compact.ts
│   ├── agents/     spawn.ts  registry.ts          # P9
│   ├── memory/     select.ts  extract.ts  consolidate.ts   # P12
│   ├── tasks/      store.ts  graph.ts             # P13
│   ├── background/ runner.ts  notify.ts           # P14
│   ├── cron/       parse.ts  scheduler.ts         # P15
│   ├── team/       mailbox.ts  claim.ts  worktree.ts       # P16
│   ├── mcp/        client.ts  pool.ts             # P17
│   ├── workflow/   runtime.ts  journal.ts         # P19
│   ├── goal/       controller.ts  evaluator.ts    # P20
│   └── ui/         App.tsx Transcript.tsx Input.tsx ToolLine.tsx
│                   ApprovalPrompt.tsx StatusBar.tsx TodoList.tsx theme.ts
├── docs/capstone.md
├── evals/          types.ts  run.ts  cases/*.ts   # P3c
└── tests/
```

---

# The 22 phases

Each prompt goes after the tutor contract. The Goal, You write and Test lines above each prompt are
part of the brief, so the prompt only adds the big picture, the idea to remember and the worked
example focus.

---

## Phase 0: project setup (done)

**Goal.** A Bun and TypeScript CLI with layered config, a `~/.shrek` state directory, and a model
registry where switching models is one environment variable.

**You write.** `package.json`, `tsconfig.json`, `.env.example`, `src/config.ts`, `src/paths.ts`,
`src/llm/models.ts`, `src/llm/client.ts`, `bin/shrek.ts`.

**Test.** `shrek --version` prints version, model, `key: ok` and the state dir. `SHREK_MODEL=...`
overrides the model. `git ls-files` does not list `.env`.

```
Write the stage document for Phase 0, using the Goal, You write and Test in plan.md.

Big picture: shrek does not exist yet. Show the finished `shrek -p` command, then say this phase
builds the settings every later phase reads: which model, which key, where files go.

Remember this: config is layered, and the last layer wins (env beats config.json beats defaults).

Worked example: resolve one key through the three layers and have me predict the winner each time.
```

---

## Phase 1: agent loop (done)

**Goal.** The agent loop as a loop over one message array, with one tool (Bash), plus a transcript
and debug log on disk. Two parts.

**You write.** Part a: `src/tools/types.ts` (`Tool<T>` with Zod params), `src/tools/bash.ts`,
`src/agent/events.ts`, `src/agent/systemPrompt.ts`, `src/agent/loop.ts` (`async function*
runAgent`, iteration cap), `bin/shrek.ts -p`. Part b: `src/log.ts`, `src/session/jsonl.ts`, and the
wiring in `loop.ts` and `bin/shrek.ts`.

**Test.** `shrek -p "how many .ts files are in this repo?"` runs Bash, answers, and
`~/.shrek/projects/<slug>/<id>.jsonl` holds every message.

```
Write the stage documents for Phase 1a and 1b, using the Goal, You write and Test in plan.md.

Big picture: after Phase 0 shrek only prints settings. After 1a it answers a question by letting
the model run a shell command, which is the whole product in miniature; every later phase wraps
this loop. 1b gives it a memory on disk that Phase 7 replays.

Remember this (1a): the message array is the conversation. Every tool call gets exactly one tool
reply, so a tool never throws; a failure is just text sent back.
Remember this (1b): the transcript is what was said, the debug log is what went over the wire.

Worked example (1a): walk the array by hand for one Bash call, then two calls at once, then a
failing command. (1b): which file answers which question.
```

---

## Phase 2: tool use (done)

**Goal.** Give the model real file tools behind one registry, so adding a tool never changes the
loop. Two parts.

**You write.** Part a: `src/tools/guards.ts` (path escape, truncation), `src/tools/registry.ts`
(register, `toOpenAITools`, `dispatch` with Zod validation returning errors as results),
`read.ts`, `write.ts`, `edit.ts` (exact match, `replace_all`, read-before-edit). Part b: `glob.ts`
(`Bun.Glob`, newest first, capped), `grep.ts` (ripgrep with a JS fallback, three output modes),
parallel dispatch of a `tool_calls` array in `loop.ts`, and `tests/tools.test.ts` over a temp dir.

**Test.** 2a: Read, Edit and the path guard behave from `shrek -p`. 2b: `bun test` is green and
`shrek -p "write a node script that prints fizzbuzz to 20, run it, fix any bug"` completes.

```
Write the stage documents for Phase 2a and 2b, using the Goal, You write and Test in plan.md.

Big picture: after Phase 1 the model can only shell out. 2a gives it Read, Write and Edit; 2b
gives it search, so it can work on a codebase it has never seen, and runs calls at once. Phase 4
puts permissions in front of these tools and Phase 5 turns dispatch into a hook point.

Remember this (2a): a tool's description and its error strings are the API the model reads.
Remember this (2b): run in parallel, answer in order. Promise.all keeps input order, and dispatch
never throws, so one failure cannot leave the other calls unanswered.

Worked example (2a): a vague Edit description, watch the model misuse it, then fix the wording.
(2b): three calls finishing out of order, then one of them failing.
```

---

## Phase 3: Ink TUI

**Goal.** A terminal UI as a React render tree, fed by the loop's events without the loop knowing.
Then an eval runner that every later phase must pass. Three parts.

**You write.** Part a: `src/ui/theme.ts`, `src/ui/ToolLine.tsx` (`⏺ Read(src/config.ts)` with a
dimmed `⎿ 42 lines`), `src/ui/Transcript.tsx` (`<Static>` for finished turns), `src/ui/App.tsx`
(a pure `apply(view, event)` reducer, `ink-text-input` as a stand-in), a `history` option on
`runAgent`, and `bin/shrek.ts` rendering `<App/>` when no `-p`, with the bridge that owns history
and the transcript. Part b: `src/ui/Input.tsx` (history, multi-line paste via `usePaste`),
`src/ui/StatusBar.tsx`, and Ctrl+C in `App` (abort the running turn, quit when idle,
`exitOnCtrlC: false`). Part c: `evals/types.ts` (a case is `{ id, phase, prompt, files?, turns?,
check }`, where `check` gets the temp dir, the events and the answer and returns pass or a reason),
`evals/run.ts` (each case in a fresh `mkdtemp` dir with its fixture files, `runAgent` headless, k
runs, default 3, pass at 2 of 3; prints a table and appends results to
`~/.shrek/evals/<date>.jsonl`; flags `--phase`, `--case`, `--k`, `--model`), an `eval` script in
`package.json`, and seed cases in `evals/cases/` for Phases 1 to 3: answer from a file, Edit one
value, Grep then Read, parallel reads, a path outside the folder refused, two-turn history.

**Test.** 3a: `shrek` opens the TUI and a two-turn chat renders tool lines and resolves "that same
file". 3b: a paste stays one message, Up recalls it, Ctrl+C mid-turn ends it as `aborted`, Ctrl+C
when idle exits cleanly. 3c: `bun test` stays green and `bun run eval` passes every seed case.

```
Write the stage documents for Phase 3a and 3b, using the Goal, You write and Test in plan.md.

Big picture: after Phase 2 shrek is one prompt per run printing plain lines. After this it is an
app I hold a conversation in. Phases 4, 6 and 8 all draw into this UI.

Remember this (3a): the loop yields events and React renders them; neither imports the other.
Remember this (3b): in raw mode Ctrl+C is just a key, so the app decides what it means.

Worked example (3a): start with a ten-line hello-world Ink app, then show what breaks if the loop
prints directly. (3b): Ctrl+C mid-turn under Ink's default, then a three-line paste into a box
where Enter submits.
```

```
Write the stage document for Phase 3c, using the Goal, You write and Test in plan.md.

Big picture: after 3b I can talk to shrek, but the only proof it still works after a change is
trying it by hand. After this one command reruns every task shrek has learned so far. From Phase 4
on, every phase adds cases and must pass the whole suite.

Remember this: a test asks "is the code right", an eval asks "does the agent still do the job".
Same task, several runs, a pass rate.

Worked example: the same Edit case run five times on the free model; predict the pass rate, then
see why a check on the file beats a check on the answer text.
```

---

## Phase 4: permission

**Goal.** A check between the model asking and the machine doing, with rules as data.

**You write.** `permissions/policy.ts` (`decide` returns allow, ask or deny; read-only tools
allowed; prefix rules like `Bash(bun test:*)`), `permissions/store.ts` (session and saved grants in
`settings.json`), `ui/ApprovalPrompt.tsx` (yes, yes-and-remember, no-with-feedback, diff preview),
the loop waiting on the prompt, and a dev-only `--yolo`.

**Test.** `rm` triggers a prompt, declining makes the agent adapt, remember survives a restart.

**Eval.** The runner gains scripted approval answers. With "no" to `rm`, the file still exists and
the answer says it was declined, with no second `rm`. A read-only task asks nothing.

```
Write the stage document for Phase 4, using the Goal, You write and Test in plan.md.

Big picture: after Phase 3 the model can delete files with nobody checking. After this nothing
risky runs until I say yes. Phase 5 moves this check into a hook.

Remember this: a denial is a tool result, not a crash. The model reads "no" and tries something
else.

Worked example: the loop pausing on a promise that the React prompt resolves; predict where
execution sits at each step.
```

---

## Phase 5: hooks, the refactor

**Goal.** Behavior attaches to the loop from outside instead of being written into it. Every later
phase adds its feature as a hook.

**You write.** `src/engine/$.ts` (the shared `$` object, mostly stubs), `bus.ts` (`on(event,
matcher, hook)`), `next.ts` (the `($, e, next)` chain), `matchers.ts`, `events.ts`, a bridge for
`PreToolUse`, `PostToolUse`, `UserPromptSubmit` and `Stop`. Move Phase 4's check out of the loop
into a `tool.check` hook.

**Test.** A test proves adding a logging hook changes no line of `src/agent/loop.ts`. Phase 4
behavior is unchanged.

**Eval.** No new case. The whole suite, Phase 4's included, passes as before with the check moved
into a hook.

```
Write the stage document for Phase 5, using the Goal, You write and Test in plan.md.

Big picture: after Phase 4 every feature means another edit inside the loop. After this the loop
stops growing; every phase from 6 to 20 plugs in from outside.

Remember this: a hook gets (e, next). Call next to let the rest run, or return early to answer
or refuse yourself. It is Express middleware for the agent loop.

Worked example: trace one Bash call through three hooks; predict the order going down and back up.
```

---

## Phase 6: streaming

**Goal.** Show the reply as it arrives, and rebuild tool calls that arrive in pieces.

**You write.** `llm/stream.ts` (`stream: true`, usage included, merging `delta.content` and
`delta.tool_calls[i].function.arguments` by index), text events through the bus, incremental render
in `App.tsx`, a spinner with elapsed time, Esc to abort via `AbortController`.

**Test.** Text appears word by word, a mid-stream tool call parses, Esc aborts without corrupting
the transcript.

**Eval.** Streaming on for every case. All earlier cases still pass, which proves tool calls
rebuilt from pieces parse. One new case makes three calls in one reply.

```
Write the stage document for Phase 6, using the Goal, You write and Test in plan.md.

Big picture: after Phase 5 shrek sits silent and then dumps a whole reply. After this it types as
it thinks and I can stop it.

Remember this: tool-call arguments arrive as string fragments split anywhere. Join them by index
and parse only at the end.

Worked example: a 15-line script printing raw chunks of one real streamed request; derive the
merge rule from what I see.
```

---

## Phase 7: sessions, usage and cost

**Goal.** Replay a transcript into live state, and turn token counts into dollars.

**You write.** `session/store.ts` (list, load, resume), `session/usage.ts` (tokens per turn, cost
from `models.ts`), `context/commands.ts` with `/usage /cost /resume /clear /model`, status bar
showing cost and context-window percentage, `--resume` and `--continue`.

**Test.** `--continue` restores a session. Token counts match openrouter.ai/activity. One
`qwen/qwen3.8-flash` request proves the dollar math.

**Eval.** The two-turn case reruns as two processes joined by `--continue`. Every run records
nonzero token usage.

```
Write the stage document for Phase 7, using the Goal, You write and Test in plan.md.

Big picture: after Phase 6 every conversation vanishes when I quit. After this I can resume it,
see what it cost, and see how full the context is, which Phase 11 needs.

Remember this: every request resends the whole array, so cost grows with conversation length,
not with the last message.

Worked example: compute one real response's cost by hand before writing the function.
```

---

## Phase 8: TodoWrite

**Goal.** Make the model write its steps down before starting.

**You write.** `src/tools/todo.ts` (`content`, `status`, `activeForm`; exactly one `in_progress`;
accepts a JSON string too), `ui/TodoList.tsx`, a system-prompt section on when to use it.

**Test.** A six-step task run with and without TodoWrite; record the difference. Checklist renders live.

**Eval.** A six-step fixture task ends with every todo `completed` and its check passing. Run it
with TodoWrite off and record both pass rates.

```
Write the stage document for Phase 8, using the Goal, You write and Test in plan.md.

Big picture: after Phase 7 the model starts a six-step job and forgets step four. After this it
writes a plan and I watch it tick.

Remember this: the todo list is not for me, it is the model's notes to itself, kept in the array
where it will see them every turn.

Worked example: compare the two transcripts and find where the no-todo run loses track.
```

---

## Phase 9: sub-agents

**Goal.** A subtask runs with a fresh message array, and only its final text comes back.

**You write.** `agents/spawn.ts` (child `runAgent`, own prompt, tools minus `Task`),
`agents/registry.ts` (`.shrek/agents/*.md` with frontmatter), a `Task` tool, `SubagentStart` and
`SubagentStop` hooks.

**Test.** `shrek -p "use a subagent to find every TODO in this repo"` works and the parent
transcript stays small; compare token counts.

**Eval.** A fixture with five TODOs in nested files: the answer lists all five, and the parent
transcript stays under a token budget the case sets.

```
Write the stage document for Phase 9, using the Goal, You write and Test in plan.md.

Big picture: after Phase 8 one long search floods the conversation. After this a second agent does
the digging and hands back only the answer. Phase 16 builds teams on this.

Remember this: isolation is the feature. The parent pays for the answer, not the search.

Worked example: parent and child arrays side by side at the moment the child returns.
```

---

## Phase 10: skills

**Goal.** Skill names sit in the prompt; bodies load only when asked for.

**You write.** `context/skills.ts` (find `.shrek/skills/*/SKILL.md`, parse frontmatter), a catalog
block in the system prompt, a `Skill` tool returning the body, `.shrek/commands/*.md` as slash
commands with `$ARGUMENTS`.

**Test.** A real Claude Code `SKILL.md` dropped in unmodified is listed at startup and its body
loads only when invoked.

**Eval.** A fixture skill holds a code word. A task that needs the skill uses the word; a task that
does not never loads the body.

```
Write the stage document for Phase 10, using the Goal, You write and Test in plan.md.

Big picture: after Phase 9 everything the model should know sits in the prompt from the start.
After this shrek lists what it can do and loads instructions on demand.

Remember this: progressive disclosure. Pay for a one-line menu every turn, pay for the recipe only
when it is ordered.

Worked example: measure tokens for all bodies inlined vs names only.
```

---

## Phase 11: compaction

**Goal.** When the context fills, make room in four steps from cheapest to most destructive.

**You write.** `context/compact.ts`: cap each tool result, offload big results to disk with a
pointer, drop old low-value turns, then summarize the rest with a cheap model. A `/compact`
command, `PreCompact` and `PostCompact` hooks.

**Test.** A task larger than the window completes. A test proves no strategy leaves a
`tool_call_id` without its reply.

**Eval.** A forced tiny context window. A task that reads many files still answers a fact from the
first one, and no `tool_call_id` is left without its reply.

```
Write the stage document for Phase 11, using the Goal, You write and Test in plan.md.

Big picture: after Phase 10 a long conversation eventually fails every request. After this shrek
makes room and keeps going.

Remember this: never cut between an assistant tool_calls message and its tool replies. They move
as one block.

Worked example: cut one array at three points; predict which cuts the API rejects.
```

---

## Phase 12: memory

**Goal.** Remember what matters across sessions, and read a repo's own `AGENTS.md`.

**You write.** `memory/extract.ts` (cheap model proposes memories), `memory/select.ts` (pick
relevant ones into the prompt), `memory/consolidate.ts` (merge duplicates), `.shrek/memory/*.md`
plus a `MEMORY.md` index, `context/agentsMd.ts` (walk cwd to git root for `AGENTS.md` and
`CLAUDE.md`), an `/init` command.

**Test.** A preference stated in one session is honored in the next. An `AGENTS.md` saying "always
use pnpm" is obeyed.

**Eval.** A fixture `AGENTS.md` says "always use pnpm": every install in Bash uses pnpm. A
preference saved in run one is followed in run two.

```
Write the stage document for Phase 12, using the Goal, You write and Test in plan.md.

Big picture: after Phase 11 every session starts knowing nothing. After this shrek carries my
preferences forward and reads the repo's own instructions first.

Remember this: store what stays true, drop what is only true today.

Worked example: classify six candidate memories as durable or temporary before writing the filter.
```

---

## Phase 13: task system

**Goal.** Big goals become small ordered tasks stored on disk, so they outlive the conversation.

**You write.** `tasks/store.ts` (one JSON file per task, atomic writes), `tasks/graph.ts`
(`blockedBy`, `canStart`), an atomic `claim`, tools `CreateTask UpdateTask ListTasks GetTask
ClaimTask CompleteTask`, `TaskCreated` and `TaskCompleted` hooks.

**Test.** A diamond-shaped graph runs in a valid order, a blocked task refuses to be claimed, the
graph survives a restart.

**Eval.** A diamond-shaped fixture goal: the task store on disk shows the four tasks finished in a
valid order.

```
Write the stage document for Phase 13, using the Goal, You write and Test in plan.md.

Big picture: after Phase 12 a plan dies with the conversation. After this steps live on disk with
their dependencies, which Phase 16's teams share.

Remember this: a claim is compare-and-set, never read-then-write.

Worked example: a four-task diamond; mark what is claimable at each step, then after a restart.
```

---

## Phase 14: background tasks

**Goal.** Slow commands run in the background while the agent keeps working.

**You write.** `background/runner.ts` (`run_in_background` on Bash, own process group, output to a
file), `background/notify.ts` (queue drained only between turns), `BashOutput` and `KillShell`
tools, cleanup on exit.

**Test.** A 30-second background build runs while the agent does other work, then reports. Ctrl+C
leaves no orphan processes (`ps` proves it).

**Eval.** A background `sleep 20 && echo built` plus a Read task: the answer has both the file fact
and the build result, and no child process outlives the run.

```
Write the stage document for Phase 14, using the Goal, You write and Test in plan.md.

Big picture: after Phase 13 a long build freezes shrek. After this it runs alongside, and Phase 15
reuses the same notify queue.

Remember this: notifications enter the array only between turns, never between a tool call and its
reply.

Worked example: inject a notification mid-turn and read the API error.
```

---

## Phase 15: cron scheduler

**Goal.** Run jobs on a schedule nobody starts, surviving restarts.

**You write.** `cron/parse.ts` (five-field matcher with validation), `cron/scheduler.ts` (tick loop,
durable `~/.shrek/schedule.json`), `ScheduleTask ListSchedules CancelSchedule` tools, `$.clock`.

**Test.** A job one minute out survives a restart and fires. A bad field is rejected by name.
Tests use a fake clock.

**Eval.** "Remind me every weekday at 9" writes one entry to `schedule.json` with
`0 9 * * 1-5`.

```
Write the stage document for Phase 15, using the Goal, You write and Test in plan.md.

Big picture: after Phase 14 nothing happens unless I type. After this shrek acts on a schedule.

Remember this: make time an input ($.clock), so tests can move it instead of sleeping.

Worked example: evaluate `*/15 9-17 * * 1-5` against six timestamps by hand.
```

---

## Phase 16: agent teams

**Goal.** Several agents work one task graph in parallel without stepping on each other. Four
parts: 16a teammates, 16b mailbox, 16c atomic claims, 16d one git worktree per task.

**You write.** `team/mailbox.ts`, `team/claim.ts`, `team/worktree.ts`, teammate lifecycle on the
bus, `TeammateIdle`, `WorktreeCreate`, `WorktreeRemove` hooks.

**Test.** Three teammates, five tasks, each claimed exactly once, ten runs in a row. Two teammates
editing one file in separate worktrees both survive the merge.

**Eval.** Paid model, k=1. Three teammates and five fixture tasks: each claimed once, every task's
check passes.

```
Write the stage documents for Phase 16a to 16d, using the Goal, You write and Test in plan.md.

Big picture: after Phase 15 one agent does one thing at a time. After this a team splits the graph
from Phase 13, each in its own worktree.

Remember this: two agents reading "unclaimed" at once is the bug; compare-and-set is the fix.

Worked example (16c): two teammates race for one task; predict the broken end state.

Recommend SHREK_MODEL=qwen/qwen3-coder-30b-a3b-instruct for the end-to-end runs.
```

---

## Phase 17: MCP

**Goal.** Tools from outside join the same pool as native ones, and the loop cannot tell them apart.

**You write.** `mcp/client.ts` (stdio JSON-RPC: `initialize`, `tools/list`, `tools/call`),
`mcp/pool.ts` (names as `mcp__<server>__<tool>`, sanitized, converted to registry entries),
`~/.shrek/mcp.json`, an allowlist of servers.

**Test.** A filesystem MCP server's tools appear in `/tools` and work. A bad tool name is sanitized
rather than crashing.

**Eval.** A fixture filesystem MCP server: the task is answered through an `mcp__` tool, visible in
the transcript.

```
Write the stage document for Phase 17, using the Goal, You write and Test in plan.md.

Big picture: after Phase 16 shrek only has tools I typed. After this it picks up any MCP server's
tools.

Remember this: an MCP tool becomes an ordinary registry entry. The loop never learns it is remote.

Worked example: a native and an MCP registry entry side by side; find what differs.
```

---

## Phase 18: integrated harness

**Goal.** Wire everything in one place, in a defined order. No new mechanism.

**You write.** `src/engine/create.ts` assembling every `$` noun, a hook registration order with
tiers, one entrypoint, and a `/context` command showing what fills the window.

**Test.** One long task fires tools, permissions, todos, a subagent, a skill, compaction, memory
and a background job, visible in the transcript. `bun test` green across all phases.

**Eval.** No new case. This phase is done when the whole suite passes at threshold.

```
Write the stage document for Phase 18, using the Goal, You write and Test in plan.md.

Big picture: seventeen mechanisms exist, each wired wherever it was needed. After this they are
assembled in one place. Say plainly that nothing new is invented.

Remember this: order is behavior. Permission sits under logging and above execution.

Worked example: I draw the hook order myself, then we reconcile it.

Use the paid fallback model for the end-to-end run.
```

---

## Phase 19: workflows

**Goal.** Fixed step sequences live in code with a resumable journal; the agent decides only what
happens inside a step.

**You write.** `workflow/runtime.ts` (steps, concurrency limit, agent-call budget, run locking),
`workflow/journal.ts` (append-only; resume skips finished steps), `.shrek/workflows/*.ts`, each
registered as a slash command.

**Test.** A three-step run killed after step 2 resumes without redoing it. The concurrency cap
holds under a 20-step fan-out.

**Eval.** A three-step workflow killed after step 2 and resumed: the journal shows steps 1 and 2
ran once.

```
Write the stage document for Phase 19, using the Goal, You write and Test in plan.md.

Big picture: after Phase 18 a repeatable job is a paragraph I retype and hope. After this it is
code that resumes where it died.

Remember this: write the journal entry before you trust the step is done, and replay it on resume.

Worked example: the journal for a three-step run, including step 2 crashing after it logged.
```

---

## Phase 20: goal loop

**Goal.** A stated goal decides when the loop may stop. A separate evaluator reviews each stop.

**You write.** `goal/evaluator.ts` (cheap model, strict JSON: met, not-met, impossible, reason),
`goal/controller.ts` (block cap, turn and token limits), wired as a `Stop` hook, `/goal <text>` and
`/goal clear`.

**Test.** An impossible goal returns control with a reason. A checkable goal continues until met,
then stops.

**Eval.** An impossible goal returns with a reason within its cap. "Make `bun test` pass" on a
fixture with one bug ends with the tests passing.

```
Write the stage document for Phase 20, using the Goal, You write and Test in plan.md.

Big picture: after Phase 19 the loop stops when the model says it is done, which it often is not.
After this a goal decides, and an impossible one hands control back.

Remember this: a loop that can be pushed onward needs a cap, or it spends money forever.

Worked example: no cap plus an evaluator that always says "not met"; compute the cost with
Phase 7's table.
```

---

## Phase 21: capstone, build a React app

**Goal.** Point the whole system at one long real task and learn from where it breaks.

**You write.** `docs/capstone.md` logging each failure (symptom, hypothesis, root cause, fix), the
fixes themselves, and `README.md`.

**Test.** In an empty directory, "build a React todo app with Vite and Tailwind, with add,
complete, delete and filter, and localStorage persistence; then run the build and verify it works"
produces an app where `bun run build` passes. Rerun on `qwen/qwen3-coder-30b-a3b-instruct` and
record the difference.

**Eval.** The capstone joins the suite as a paid, k=1 case: `bun run build` exits 0.

```
Write the stage document for Phase 21, using the Goal, You write and Test in plan.md. Only
learn/phase-21.md. shrek will write files in the scratch directory; that is the point.

Big picture: every mechanism exists. This phase finds where it breaks; failure is the content.

Remember this: one hypothesis, one fix, rerun. Predict what the debug log should show before
looking.

Your task is a loop: run, state the symptom, hypothesize, check the log, fix one thing, rerun.
Likely suspects: truncation, Edit exact-match on big files, the iteration cap, rate limits,
compaction losing a path, the model never verifying its work.
```

---

## Verification (whole system)

1. `bun test` passes every phase's tests, and `bun run eval` meets its threshold on every case.
2. `shrek --version` resolves config; `SHREK_MODEL` overrides.
3. `shrek -p "read package.json and list the deps"` runs headless.
4. TUI: chat, approve a Write, Esc a long reply, `/cost`, quit, `--continue`.
5. Adding a hook changes no line of `src/agent/loop.ts` (asserted by a test).
6. A real Claude Code skill and agent file load unmodified from `.shrek/`.
7. Three teammates claim five tasks exactly once, ten runs in a row.
8. A killed workflow resumes without redoing finished steps.
9. An impossible goal returns control with a reason.
10. The capstone's `bun run build` passes.
11. `git log --oneline` shows one commit per phase; `git ls-files | grep -E '^\.env$'` prints
    nothing.

## Cost

P0 to P15 run free. P7's check plus the paid runs in P16, P18, P20 and P21 cost about $0.50 to
$1.50. Total under $2. Evals run on the free model at k=3; the paid cases from P16 on run at k=1,
which adds a few cents per full run.
