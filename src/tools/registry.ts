import { z } from 'zod'
import type {
  ChatCompletionFunctionTool,
  ChatCompletionMessageToolCall,
} from 'openai/resources/chat/completions'
import type { AnyTool, ToolContext } from './types'

/** One finished call. `isError` is a fact about the result, never a reason to throw. */
export type ToolResult = { id: string; output: string; isError: boolean }

export type Registry = {
  /** Name and description only, which is all the model is ever given. Phase 5's `$.tool.list()`. */
  list(): { name: string; description: string }[]
  /** The `tools` array sent on every request, built once. */
  toOpenAITools(): ChatCompletionFunctionTool[]
  /** The display line, before the call runs. Phase 3 puts this on screen. */
  renderCall(call: ChatCompletionMessageToolCall): { name: string; line: string }
  /** Runs one call and returns its result. Never throws. */
  dispatch(call: ChatCompletionMessageToolCall, ctx: ToolContext): Promise<ToolResult>
}

/** `undefined` means the model sent something that is not JSON. `JSON.parse` never returns it. */
function parseArguments(raw: string): unknown {
  try {
    return JSON.parse(raw || '{}')
  } catch {
    return undefined
  }
}

function schemaOf(tool: AnyTool): ChatCompletionFunctionTool {
  const parameters = z.toJSONSchema(tool.params) as Record<string, unknown>
  delete parameters.$schema
  return {
    type: 'function',
    function: { name: tool.name, description: tool.description, parameters },
  }
}

export function createRegistry(tools: AnyTool[]): Registry {
  const byName = new Map(tools.map((tool) => [tool.name, tool]))
  const schemas = tools.map(schemaOf)

  return {
    list: () => tools.map(({ name, description }) => ({ name, description })),
    toOpenAITools: () => schemas,

    renderCall(call) {
      if (call.type !== 'function') return { name: call.type, line: `${call.type}(?)` }
      const name = call.function.name
      const tool = byName.get(name)
      if (!tool) return { name, line: `${name}(?)` }
      const parsed = tool.params.safeParse(parseArguments(call.function.arguments))
      return { name, line: parsed.success ? tool.renderLine(parsed.data) : `${name}(?)` }
    },

    async dispatch(call, ctx) {
      const fail = (output: string): ToolResult => ({ id: call.id, output, isError: true })
      if (call.type !== 'function') return fail(`Error: unsupported tool call type ${call.type}`)

      const name = call.function.name
      const tool = byName.get(name)
      if (!tool) {
        return fail(`Error: no tool named ${name}. Available: ${[...byName.keys()].join(', ')}`)
      }

      const raw = parseArguments(call.function.arguments)
      if (raw === undefined) {
        return fail(`Error: arguments for ${name} were not valid JSON: ${call.function.arguments}`)
      }

      const parsed = tool.params.safeParse(raw)
      if (!parsed.success) {
        return fail(`Error: invalid arguments for ${name}: ${parsed.error.message}`)
      }

      try {
        return { id: call.id, output: await tool.execute(parsed.data, ctx), isError: false }
      } catch (error) {
        return fail(`Error: ${error instanceof Error ? error.message : String(error)}`)
      }
    },
  }
}
