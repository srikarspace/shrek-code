import { z } from 'zod'
import { relative } from 'node:path'
import type { Tool } from './types'
import { resolveInside } from './guards'

const params = z.object({
  file_path: z.string().describe('Path to the file to change. Read it first.'),
  old_string: z
    .string()
    .min(1)
    .describe(
      'The exact text to replace, copied from a Read of this file. It must match byte for byte, ' +
        'including indentation, and must never include the line numbers Read prints.',
    ),
  new_string: z.string().describe('The text to put in its place. Pass an empty string to delete.'),
  replace_all: z
    .boolean()
    .optional()
    .describe('Replace every occurrence. Without it, old_string must appear exactly once.'),
})


/** The changed region with line numbers, so the model can see what it did. */
function preview(text: string, at: number, inserted: string): string {
  const lines = text.split('\n')
  const changed = text.slice(0, at).split('\n').length
  const from = Math.max(0, changed - 3)
  const to = Math.min(lines.length, changed + inserted.split('\n').length + 2)
  return lines
    .slice(from, to)
    .map((line, i) => `${String(from + i + 1).padStart(6)}\t${line}`)
    .join('\n')
}

export const edit: Tool<z.infer<typeof params>> = {
  name: 'Edit',
  description: 'Replace an exact piece of text in a file with different text. ' +
    'old_string must appear exactly once in the file, so include enough surrounding lines to make ' +
    'it unique; to change every occurrence instead, pass replace_all: true. ' +
    'You must Read a file before you Edit it. ' +
    'Prefer this over Write for any file that already exists.',
  params,
  renderLine: ({ file_path }) => `Edit(${file_path})`,

  async execute({ file_path, old_string, new_string, replace_all }, ctx) {
    const path = resolveInside(ctx.cwd, file_path)
    const shown = relative(ctx.cwd, path)

    if (!ctx.readFiles.has(path)) {
      return `Error: you have not read ${shown} in this conversation. Call Read on it first, then Edit it.`
    }
    if (old_string === new_string) {
      return `Error: old_string and new_string are identical, so this edit would change nothing.`
    }

    const text = await Bun.file(path).text()
    const count = text.split(old_string).length - 1

    if (count === 0) {
      return (
        `Error: old_string was not found in ${shown}. It must match the file exactly, including ` +
        `indentation and without line numbers. Read ${shown} again and copy the text from it.`
      )
    }
    if (count > 1 && !replace_all) {
      return (
        `Error: old_string appears ${count} times in ${shown}. Add more surrounding lines to make ` +
        `it unique, or pass replace_all: true to change all ${count}.`
      )
    }

    const at = text.indexOf(old_string)
    const updated = replace_all
      ? text.split(old_string).join(new_string)
      : text.slice(0, at) + new_string + text.slice(at + old_string.length)

    await Bun.write(path, updated)
    return `Edited ${shown}, ${count} replacement${count === 1 ? '' : 's'}.\n${preview(updated, at, new_string)}`
  },
}
