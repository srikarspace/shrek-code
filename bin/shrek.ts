#!/usr/bin/env bun
import pkg from '../package.json'
import { loadConfig, type Config } from '../src/config'
import { createClient, keyStatus } from '../src/llm/client'
import { lookupModel } from '../src/llm/models'
import { ensureStateDir, stateDir } from '../src/paths'
import { runAgent } from '../src/agent/loop'
import { bash } from '../src/tools/bash'
import { enableDebug } from '../src/log'
import { openTranscript } from '../src/session/jsonl'
import { createRegistry } from '../src/tools/registry'
import { read } from '../src/tools/read'
import { write } from '../src/tools/write'
import { edit } from '../src/tools/edit'

const registry = createRegistry([bash, read, write, edit])


function versionLines(config: Config): string[] {
  const info = lookupModel(config.model)
  const note = info
    ? `${Math.round(info.context / 1000)}k ctx, ${info.free ? 'free' : 'paid'}`
    : 'unknown to registry, no cost tracking'

  return [
    `shrek ${pkg.version}`,
    `model: ${config.model} (${note})`,
    `key: ${keyStatus(config)}`,
    `state: ${stateDir()}`,
  ]
}

async function runPrint(config: Config, prompt: string): Promise<number> {
  const client = createClient(config)
  const controller = new AbortController()
  process.on('SIGINT', () => controller.abort())
  const transcript = await openTranscript()

  for await (const event of runAgent({
    client,
    model: config.model,
    registry,
    prompt,
    signal: controller.signal,
    onMessage: (message) => transcript.write('message', { message }),
  })) {
    if (event.type === 'turn.step' && event.kind === 'tool') console.error(event.line)

    if (event.type === 'turn.complete') {
      if (event.reason === 'answer') {
        console.log(event.answer)
        return 0
      }
      console.error(`shrek: turn ended with ${event.reason}: ${event.answer}`)
      return 1
    }
  }
  return 1
}

async function main(argv: string[]): Promise<number> {
  const config = await loadConfig()
  await ensureStateDir()
  enableDebug(config.debug || argv.includes('--debug'))

  if (argv.includes('--version') || argv.includes('-v')) {
    for (const line of versionLines(config)) console.log(line)
    return 0
  }

  const flag = argv.findIndex((a) => a === '-p' || a === '--print')
  if (flag !== -1) {
    const prompt = argv[flag + 1]
    if (!prompt) {
      console.error('usage: shrek -p "your question"')
      return 1
    }
    return runPrint(config, prompt)
  }

  console.error('usage: shrek --version | shrek -p "your question"')
  return 1
}

const code = await main(process.argv.slice(2)).catch((error: unknown) => {
  console.error(`shrek: ${error instanceof Error ? error.message : String(error)}`)
  return 1
})

process.exit(code)