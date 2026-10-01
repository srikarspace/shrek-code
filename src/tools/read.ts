import { z } from 'zod'
import { stat } from 'node:fs/promises'
import type { Tool } from './types'
import { MAX_FILE_BYTES, resolveInside, truncate } from './guards'

const DEFAULT_LIMIT = 2000

const params = z.object({
  file_path: z.string().describe('Path to the file, relative to the project directory or absolute.'),
  offset: z
    .number()
    .int()
    .min(1)
    .optional()
    .describe('First line to return, counting from 1. Use with limit to page through a long file.'),
  limit: z
    .number()
    .int()
    .min(1)
    .optional()
    .describe(`How many lines to return. Defaults to ${DEFAULT_LIMIT}.`),
})

export const read: Tool<z.infer<typeof params>> = {
  name: 'Read',
  description:
    'Read a file from the project and return its contents with a line number on every line. ' +
    'The line numbers are a reading aid and are not part of the file, so never include them in ' +
    'an Edit. Use offset and limit to page through a file longer than 2000 lines. ' +
    'You must Read a file before you can Edit it.',
  params,
  renderLine: ({ file_path }) => `Read(${file_path})`,

  async execute({ file_path, offset, limit }, ctx) {
    const path = resolveInside(ctx.cwd, file_path)

    const info = await stat(path).catch(() => null)
    if (!info) return `Error: ${file_path} does not exist. Use Glob to find the right path.`
    if (info.isDirectory()) {
      return `Error: ${file_path} is a directory. Use Glob with a pattern like ${file_path}/** instead.`
    }
    if (info.size > MAX_FILE_BYTES) {
      return (
        `Error: ${file_path} is ${info.size} bytes, over the ${MAX_FILE_BYTES} byte limit. ` +
        `Use Grep to search it, or offset and limit to read part of it.`
      )
    }

    const text = await Bun.file(path).text()
    ctx.readFiles.add(path)
    if (text === '') return '(file is empty)'

    const lines = text.split('\n')
    const start = (offset ?? 1) - 1
    const end = start + (limit ?? DEFAULT_LIMIT)
    const page = lines.slice(start, end)
    if (page.length === 0) {
      return `Error: offset ${offset} is past the end of ${file_path}, which has ${lines.length} lines.`
    }

    const body = page.map((line, i) => `${String(start + i + 1).padStart(6)}\t${line}`).join('\n')
    const rest = lines.length - end
    return truncate(rest > 0 ? `${body}\n... ${rest} more lines` : body)
  },
}
