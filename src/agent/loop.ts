import type OpenAI from 'openai'
import type {
  ChatCompletionMessageParam,
  ChatCompletionMessageToolCall,
} from 'openai/resources/chat/completions'
import type { AnyTool } from '../tools/types'
import { toOpenAITool } from '../tools/types'
import type { AgentEvent, TurnCompleteReason } from './events'
import { systemPrompt } from './systemPrompt'
import { debug } from '../log'

export type RunOptions = {
  client: OpenAI
  model: string
  tools: AnyTool[]
  prompt: string
  cwd?: string
  /** The cap. Twenty rounds is more than any sane task needs. */
  maxSteps?: number
  signal?: AbortSignal
    /** Called for every message added to the array, in order. The transcript writer. */
  onMessage?: (message: ChatCompletionMessageParam) => Promise<void>
}

/** Validated and ready, or the exact string the model gets back instead. */
type Prepared = { tool: AnyTool; args: unknown } | { error: string }

function prepare(tools: Map<string, AnyTool>, call: ChatCompletionMessageToolCall): Prepared {
  if (call.type !== 'function') return { error: `Error: unsupported tool call type ${call.type}` }

  const tool = tools.get(call.function.name)
  if (!tool) {
    const known = [...tools.keys()].join(', ')
    return { error: `Error: no tool named ${call.function.name}. Available: ${known}` }
  }

  let raw: unknown
  try {
    raw = JSON.parse(call.function.arguments || '{}')
  } catch {
    const sent = JSON.stringify(call.function.arguments)
    return { error: `Error: arguments were not valid JSON: ${sent}` }
  }

  const parsed = tool.params.safeParse(raw)
  if (!parsed.success) {
    return { error: `Error: invalid arguments for ${tool.name}: ${parsed.error.message}` }
  }

  return { tool, args: parsed.data }
}

export async function* runAgent(opts: RunOptions): AsyncGenerator<AgentEvent, void, void> {
  const cwd = opts.cwd ?? process.cwd()
  const maxSteps = opts.maxSteps ?? 20
  const signal = opts.signal ?? new AbortController().signal
  const turnId = crypto.randomUUID()
  const startedAt = Date.now()

  const byName = new Map(opts.tools.map((tool) => [tool.name, tool]))
  const schemas = opts.tools.map(toOpenAITool)

  const messages: ChatCompletionMessageParam[] = []
  async function add(message: ChatCompletionMessageParam): Promise<void> {
    messages.push(message)
    await opts.onMessage?.(message)
  }

  await add({ role: 'system', content: systemPrompt(cwd) })
  await add({ role: 'user', content: opts.prompt })

  yield { type: 'turn.start', turnId, text: opts.prompt }

  let answer = ''
  let reason: TurnCompleteReason = 'answer'

  try {
    for (let step = 1; step <= maxSteps; step++) {
      if (signal.aborted) {
        reason = 'aborted'
        yield { type: 'turn.abort', turnId }
        break
      }

      await debug('request', { model: opts.model, step, messages })
      const response = await opts.client.chat.completions.create(
        { model: opts.model, messages, tools: schemas, max_tokens: 8000 },
        { signal },
      )
      await debug('response', response)

      const message = response.choices[0]?.message
      if (!message) throw new Error('the model returned no choices')
      await add(message)

      if (message.content) {
        answer = message.content
        yield { type: 'turn.step', turnId, step, kind: 'text', text: message.content }
      }

      const calls = message.tool_calls ?? []
      if (calls.length === 0) break

      for (const call of calls) {
        const ready = prepare(byName, call)
        const name = call.type === 'function' ? call.function.name : call.type
        const line = 'error' in ready ? `${name}(?)` : ready.tool.renderLine(ready.args)
        yield { type: 'turn.step', turnId, step, kind: 'tool', id: call.id, name, line }

        let output: string
        if ('error' in ready) {
          output = ready.error
        } else {
          try {
            output = await ready.tool.execute(ready.args, { cwd, signal })
          } catch (error) {
            output = `Error: ${error instanceof Error ? error.message : String(error)}`
          }
        }

        await add({ role: 'tool', tool_call_id: call.id, content: output })
        yield { type: 'turn.step', turnId, step, kind: 'result', id: call.id, output }
      }

      if (step === maxSteps) reason = 'max_steps'
    }
  } catch (error) {
    reason = signal.aborted ? 'aborted' : 'error'
    answer = error instanceof Error ? error.message : String(error)
    await debug('error', { message: answer })
  }

  yield {
    type: 'turn.complete',
    turnId,
    answer,
    durationMs: Date.now() - startedAt,
    isAborted: reason === 'aborted',
    reason,
  }
}