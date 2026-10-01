import type OpenAI from 'openai'
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions'
import type { AgentEvent, TurnCompleteReason } from './events'
import { systemPrompt } from './systemPrompt'
import { debug } from '../log'
import type { Registry } from '../tools/registry'
import type { ToolContext } from '../tools/types'

export type RunOptions = {
  client: OpenAI
  model: string
  registry: Registry
  prompt: string
  cwd?: string
  /** The cap. Twenty rounds is more than any sane task needs. */
  maxSteps?: number
  signal?: AbortSignal
    /** Called for every message added to the array, in order. The transcript writer. */
  onMessage?: (message: ChatCompletionMessageParam) => Promise<void>
}

export async function* runAgent(opts: RunOptions): AsyncGenerator<AgentEvent, void, void> {
  const cwd = opts.cwd ?? process.cwd()
  const maxSteps = opts.maxSteps ?? 20
  const signal = opts.signal ?? new AbortController().signal
  const turnId = crypto.randomUUID()
  const startedAt = Date.now()

  const schemas = opts.registry.toOpenAITools();
  const ctx: ToolContext = { cwd, signal, readFiles: new Set() }

  const messages: ChatCompletionMessageParam[] = []
  async function add(message: ChatCompletionMessageParam): Promise<void> {
    console.log(message);
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
        const { name, line } = opts.registry.renderCall(call)
        yield { type: 'turn.step', turnId, step, kind: 'tool', id: call.id, name, line }

        const result = await opts.registry.dispatch(call, ctx)
        await add({ role: 'tool', tool_call_id: result.id, content: result.output })
        yield { type: 'turn.step', turnId, step, kind: 'result', id: result.id, output: result.output }
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