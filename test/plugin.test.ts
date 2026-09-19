import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { LlmAdapter, LlmRuntime, type ToolSchema } from '@deepseek-ai/dsh-llm'
import { apply } from '../src/plugin.js'

class Adapter extends LlmAdapter {
  providerInfo(provider: string) { return { id: provider, name: provider } }
  async resolveModel(provider: string, model: string) { return { provider, id: model, name: model } }
  async *stream() {
    yield { type: 'block-start' as const, index: 0, blockType: 'tool-call' as const }
    yield { type: 'tool-call-delta' as const, index: 0, id: 'call_A' as never, name: 'tool_a', argumentsDelta: '{}' }
    yield { type: 'block-end' as const, index: 0, block: { type: 'tool-call' as const, id: 'call_A' as never, name: 'tool_a', arguments: '{}' } }
    yield { type: 'finish' as const, reason: { kind: 'tool-calls' as const } }
  }
}

class AlwaysRetryAdapter extends Adapter {
  override providerRetryPolicy() {
    return { mode: 'always' as const, initialDelayMs: 1, maxDelayMs: 1, jitterRatio: 0 }
  }
}

const request = (tools: ToolSchema[] = [{ name: 'tool_a', description: 'a', parameters: {} }]) => ({
  provider: 'probe', model: 'model', messages: [], tools,
})

describe('Cordis binding', () => {
  it('rejects unknown configuration at the apply entry point', () => {
    const ctx = new Context()
    new LlmRuntime(ctx)
    expect(() => apply(ctx, { unknown: true })).toThrow(/unknown field unknown/)
  })

  it('[TP-045] warns once when a registered provider uses always retry', () => {
    const ctx = new Context()
    const llm = new LlmRuntime(ctx)
    const warnings: string[] = []
    ctx.logger.exporter({
      levels: { default: 3 },
      export: message => warnings.push(...message.args.map(String)),
    })
    apply(ctx, {})
    const registration = llm.registerAdapter(['always-probe'], new AlwaysRetryAdapter())
    registration.replace(['always-probe'])
    const warning = 'provider=always-probe retryPolicy=always; integrity failures may be retried indefinitely'
    expect(warnings.filter(message => message === warning)).toHaveLength(1)
  })

  it('[TP-047] wraps the real LlmRuntime stream and passes a healthy tail', async () => {
    const ctx = new Context()
    const llm = new LlmRuntime(ctx)
    llm.registerAdapter(['probe'], new Adapter())
    apply(ctx, {})
    const output = []
    for await (const chunk of llm.stream(request())) output.push(chunk)
    expect(output).toHaveLength(4)
    expect(output.at(-1)).toEqual({ type: 'finish', reason: { kind: 'tool-calls' } })
  })

  it('[TP-048/TP-050] blocks a malformed chunk produced by an inner listener', async () => {
    const ctx = new Context()
    const llm = new LlmRuntime(ctx)
    llm.registerAdapter(['probe'], new Adapter())
    ctx.on('llm/stream', (_options, next) => (async function* () {
      for await (const chunk of next()) {
        yield chunk.type === 'tool-call-delta' ? { ...chunk, id: '' as never } : chunk
      }
    })())
    apply(ctx, {})
    const output = []
    for await (const chunk of llm.stream(request())) output.push(chunk)
    expect(output).toHaveLength(1)
    expect(output[0]).toMatchObject({ type: 'finish', reason: { kind: 'error', failure: { code: 'STREAM_INTEGRITY_VIOLATION' } } })
  })

  it('[TP-051] exposes the documented boundary for a later outer prepend listener', async () => {
    const ctx = new Context()
    const llm = new LlmRuntime(ctx)
    llm.registerAdapter(['probe'], new Adapter())
    apply(ctx, {})
    ctx.on('llm/stream', (_options, next) => (async function* () {
      for await (const chunk of next()) {
        yield chunk.type === 'tool-call-delta' ? { ...chunk, id: '' as never } : chunk
      }
    })(), { global: true, prepend: true })
    const output = []
    for await (const chunk of llm.stream(request())) output.push(chunk)
    expect(output.some(chunk => chunk.type === 'tool-call-delta' && chunk.id === '')).toBe(true)
    expect(output.some(chunk => chunk.type === 'finish' && chunk.reason.kind === 'error' && chunk.reason.failure?.code === 'STREAM_INTEGRITY_VIOLATION')).toBe(false)
  })

  it('[TP-043] keeps tool argument canaries out of the real binding logger', async () => {
    const canary = 'canary-tool-argument-9f2c'
    const ctx = new Context()
    const llm = new LlmRuntime(ctx)
    const logs: string[] = []
    ctx.logger.exporter({
      levels: { default: 3 },
      export: message => logs.push(...message.args.map(String)),
    })
    llm.registerAdapter(['probe'], new Adapter())
    ctx.on('llm/stream', (_options, next) => (async function* () {
      for await (const chunk of next()) {
        yield chunk.type === 'tool-call-delta'
          ? { ...chunk, id: '' as never, argumentsDelta: canary }
          : chunk
      }
    })())
    apply(ctx, {})
    const output = []
    for await (const chunk of llm.stream(request())) output.push(chunk)
    expect(output).toHaveLength(1)
    expect(logs.join('\n')).not.toContain(canary)
  })

  it('[TP-041] keeps enforce blocking active while diagnostics are off', async () => {
    const ctx = new Context()
    const llm = new LlmRuntime(ctx)
    const logs: string[] = []
    ctx.logger.exporter({
      levels: { default: 3 },
      export: message => logs.push(...message.args.map(String)),
    })
    llm.registerAdapter(['probe'], new Adapter())
    ctx.on('llm/stream', (_options, next) => (async function* () {
      for await (const chunk of next()) {
        yield chunk.type === 'tool-call-delta' ? { ...chunk, id: '' as never } : chunk
      }
    })())
    const dispose = apply(ctx, { diagnostics: 'off' })
    const output = []
    for await (const chunk of llm.stream(request())) output.push(chunk)
    dispose()
    expect(output).toHaveLength(1)
    expect(output[0]).toMatchObject({ type: 'finish', reason: { kind: 'error', failure: { code: 'STREAM_INTEGRITY_VIOLATION' } } })
    expect(logs.some(message => message.includes('normalized model stream rejected'))).toBe(false)
  })

  it('[TP-001] returns the original iterable path for calls without tools', async () => {
    const ctx = new Context()
    const llm = new LlmRuntime(ctx)
    llm.registerAdapter(['probe'], new Adapter())
    apply(ctx, {})
    const output = []
    for await (const chunk of llm.stream(request([]))) output.push(chunk)
    expect(output).toHaveLength(4)
  })

  it('[TP-055] removes the stream listener when the binding disposer runs', async () => {
    const ctx = new Context()
    const llm = new LlmRuntime(ctx)
    llm.registerAdapter(['probe'], new Adapter())
    ctx.on('llm/stream', (_options, next) => (async function* () {
      for await (const chunk of next()) {
        yield chunk.type === 'tool-call-delta' ? { ...chunk, id: '' as never } : chunk
      }
    })())
    const dispose = apply(ctx, {})
    expect(dispose()).toBe(true)
    const output = []
    for await (const chunk of llm.stream(request())) output.push(chunk)
    expect(output.some(chunk => chunk.type === 'tool-call-delta' && chunk.id === '')).toBe(true)
  })
})
