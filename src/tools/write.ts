import { z } from 'zod'
import { mkdir, stat } from 'node:fs/promises'
import { dirname, relative } from 'node:path'
import type { Tool } from './types'
import { resolveInside } from './guards'

const params = z.object({
  file_path: z
    .string()
    .describe('Path to write, relative to the project directory or absolute. Missing parent directories are created.'),
  content: z.string().describe('The complete contents of the file. This replaces the file entirely.'),
})

export const write: Tool<z.infer<typeof params>> = {
  name: 'Write',
  description:
    'Write a whole file, creating it and any missing parent directories, or replacing it if it ' +
    'already exists. The content you give becomes the entire file, so to change part of an ' +
    'existing file use Edit instead. Prefer Edit for any file you did not create yourself.',
  params,
  renderLine: ({ file_path, content }) => `Write(${file_path}, ${content.length} bytes)`,

  async execute({ file_path, content }, ctx) {
    const path = resolveInside(ctx.cwd, file_path)
    const existed = (await stat(path).catch(() => null)) !== null

    await mkdir(dirname(path), { recursive: true })
    const bytes = await Bun.write(path, content)
    ctx.readFiles.add(path)

    const shown = relative(ctx.cwd, path)
    const lines = content === '' ? 0 : content.split('\n').length
    return `${existed ? 'Replaced' : 'Created'} ${shown}, ${bytes} bytes, ${lines} lines`
  },
}
