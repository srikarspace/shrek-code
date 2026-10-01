import { z } from 'zod'

/** What a tool is allowed to know about the run it is part of. */
export type ToolContext = {
  cwd: string
  /** Aborted when the user hits ctrl-c. Long tools must respect it. */
  signal: AbortSignal
  /** Absolute paths Read has returned this run. Edit refuses a path that is not in here. */
  readFiles: Set<string>
}

/** One capability the model can ask for. `T` is the shape of its arguments. */
export type Tool<T> = {
  name: string
  /** The model reads this to decide when to call it. Phase 2 is about this string. */
  description: string
  /** Validates input, generates the schema, and supplies `T`. One source of truth. */
  params: z.ZodType<T>
  /** What the model sees. Returns a string on every path, including failure. */
  execute(args: T, ctx: ToolContext): Promise<string>
  /** One readable line, like `$ ls src`. Phase 3 renders it. */
  renderLine(args: T): string
}

/** Any tool, for the arrays and maps that hold tools of different shapes. */
export type AnyTool = Tool<any>
