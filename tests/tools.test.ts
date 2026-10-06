import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ToolContext } from '../src/tools/types'
import { resolveInside } from '../src/tools/guards'
import { createRegistry } from '../src/tools/registry'
import { read } from '../src/tools/read'
import { write } from '../src/tools/write'
import { edit } from '../src/tools/edit'
import { glob } from '../src/tools/glob'
import { grep } from '../src/tools/grep'

let dir = ''

/** A fresh context per test, so one test's Read cannot unlock another test's Edit. */
function ctx(): ToolContext {
  return { cwd: dir, signal: new AbortController().signal, readFiles: new Set() }
}

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'shrek-'))
  await mkdir(join(dir, 'src'), { recursive: true })
  await writeFile(join(dir, 'src/a.ts'), 'const x = 1\nconst y = 1\n')
  await writeFile(join(dir, 'src/b.ts'), 'export const name = "shrek"\n')
  // Glob sorts by modification time, so set them rather than trusting write order.
  await utimes(join(dir, 'src/a.ts'), new Date(1_000_000), new Date(1_000_000))
  await utimes(join(dir, 'src/b.ts'), new Date(2_000_000), new Date(2_000_000))
})

afterAll(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('Read', () => {
  test('numbers every line and records the resolved path', async () => {
    const c = ctx()
    const out = await read.execute({ file_path: 'src/a.ts' }, c)
    expect(out).toBe('     1\tconst x = 1\n     2\tconst y = 1\n     3\t')
    expect(c.readFiles.has(join(dir, 'src/a.ts'))).toBe(true)
  })

  test('offset and limit page through the file', async () => {
    const out = await read.execute({ file_path: 'src/a.ts', offset: 2, limit: 1 }, ctx())
    expect(out).toBe('     2\tconst y = 1\n... 1 more lines')
  })

  test('a missing file is a result, not a throw', async () => {
    const out = await read.execute({ file_path: 'nope.ts' }, ctx())
    expect(out).toStartWith('Error: nope.ts does not exist')
  })
})

describe('Write', () => {
  test('creates missing parents and says what it did', async () => {
    const c = ctx()
    const out = await write.execute({ file_path: 'a/b/c.txt', content: 'hi\n' }, c)
    expect(out).toBe('Created a/b/c.txt, 3 bytes, 2 lines')
    expect(await Bun.file(join(dir, 'a/b/c.txt')).text()).toBe('hi\n')
  })
})

describe('Edit', () => {
  test('refuses a file that has not been read', async () => {
    const out = await edit.execute(
      { file_path: 'src/a.ts', old_string: 'const x', new_string: 'let x' },
      ctx(),
    )
    expect(out).toStartWith('Error: you have not read src/a.ts')
  })

  test('refuses an ambiguous match, names the count, and changes nothing', async () => {
    const c = ctx()
    await read.execute({ file_path: 'src/a.ts' }, c)
    const out = await edit.execute({ file_path: 'src/a.ts', old_string: 'const', new_string: 'let' }, c)
    expect(out).toContain('appears 2 times')
    expect(await Bun.file(join(dir, 'src/a.ts')).text()).toBe('const x = 1\nconst y = 1\n')
  })

  test('replace_all changes every occurrence', async () => {
    const c = ctx()
    await write.execute({ file_path: 'all.txt', content: 'a\na\na\n' }, c)
    const out = await edit.execute(
      { file_path: 'all.txt', old_string: 'a', new_string: 'b', replace_all: true },
      c,
    )
    expect(out).toStartWith('Edited all.txt, 3 replacements.')
    expect(await Bun.file(join(dir, 'all.txt')).text()).toBe('b\nb\nb\n')
  })

  test('a single match is spliced, so $ has no special meaning', async () => {
    const c = ctx()
    await write.execute({ file_path: 'money.txt', content: 'cost: $5\n' }, c)
    await edit.execute({ file_path: 'money.txt', old_string: '$5', new_string: '$&9' }, c)
    expect(await Bun.file(join(dir, 'money.txt')).text()).toBe('cost: $&9\n')
  })
})

describe('Glob', () => {
  test('returns matches newest first', async () => {
    expect(await glob.execute({ pattern: 'src/*.ts' }, ctx())).toBe('src/b.ts\nsrc/a.ts')
  })

  test('says so when nothing matches', async () => {
    expect(await glob.execute({ pattern: '**/*.py' }, ctx())).toBe('(no files match **/*.py)')
  })
})

describe('Grep', () => {
  test('both engines find the same things', async () => {
    const args = { pattern: 'const x', glob: '*.ts', output_mode: 'content' as const }
    const fromRipgrep = await grep.execute(args, ctx())

    process.env.SHREK_GREP = 'js'
    const fromJavaScript = await grep.execute(args, ctx())
    delete process.env.SHREK_GREP

    expect(fromRipgrep).toContain('src/a.ts:1:const x = 1')
    expect(fromJavaScript).toBe(fromRipgrep)
  })
})

describe('guards and dispatch', () => {
  test('a path outside the workspace throws', () => {
    expect(() => resolveInside(dir, '../escape.txt')).toThrow('escapes the workspace')
  })

  test('dispatch turns a throw into an error result', async () => {
    const registry = createRegistry([read])
    const result = await registry.dispatch(
      {
        id: 'call_1',
        type: 'function',
        function: { name: 'Read', arguments: '{"file_path":"../escape.txt"}' },
      },
      ctx(),
    )
    expect(result.isError).toBe(true)
    expect(result.output).toStartWith('Error: path escapes the workspace')
  })

  test('an unknown tool name comes back with the list of real ones', async () => {
    const registry = createRegistry([read, write])
    const result = await registry.dispatch(
      { id: 'call_2', type: 'function', function: { name: 'read_file', arguments: '{}' } },
      ctx(),
    )
    expect(result.output).toBe('Error: no tool named read_file. Available: Read, Write')
  })

  test('arguments that do not match the schema come back named', async () => {
    const registry = createRegistry([read])
    const result = await registry.dispatch(
      { id: 'call_3', type: 'function', function: { name: 'Read', arguments: '{"file_path":5}' } },
      ctx(),
    )
    expect(result.isError).toBe(true)
    expect(result.output).toStartWith('Error: invalid arguments for Read')
  })
})