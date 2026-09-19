import { Context } from '@deepseek-ai/cordis'
import { createUserMessage, LlmAdapter } from '@deepseek-ai/dsh-llm'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import { SessionId } from '@deepseek-ai/dsh-session'
import { describe, expect, it } from 'vitest'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import SessionStore from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import * as retry from '@deepseek-ai/dsh-llm-retry'
import * as sentinel from '../src/plugin.js'

class ProbeAdapter extends LlmAdapter {
  calls = 0
  readonly entered = Promise.withResolvers<void>()
  constructor(
    private readonly mode: 'healthy' | 'corrupt' | 'always-recover' | 'abort',
    private readonly retryPolicy?: {
      readonly mode: 'always'
      readonly initialDelayMs: number
      readonly maxDelayMs: number
      readonly jitterRatio: number
    },
  ) { super() }

  override providerRetryPolicy() { return this.retryPolicy }

  async *stream(options: { signal?: AbortSignal }): AsyncIterableIterator<never> {
    this.calls += 1
    this.entered.resolve()
    if (this.mode === 'abort') {
      yield { type: 'block-start', index: 0, blockType: 'tool-call' } as never
      yield { type: 'tool-call-delta', index: 0, id: 'call_A', name: 'spy', argumentsDelta: '{}' } as never
      await new Promise<void>(resolve => {
        if (options.signal?.aborted) resolve()
        else options.signal?.addEventListener('abort', () => resolve(), { once: true })
      })
      return
    }
    if (this.mode === 'corrupt' || (this.mode === 'always-recover' && this.calls === 1)) {
      yield { type: 'block-start', index: 0, blockType: 'tool-call' } as never
      yield { type: 'tool-call-delta', index: 0, id: 'call_A', name: 'spy', argumentsDelta: '{}' } as never
      yield { type: 'tool-call-delta', index: 0, id: 'call_B', name: 'spy', argumentsDelta: '' } as never
      return
    }
    if (this.mode === 'healthy' && this.calls === 1) {
      yield { type: 'block-start', index: 0, blockType: 'tool-call' } as never
      yield { type: 'tool-call-delta', index: 0, id: 'call_A', name: 'spy', argumentsDelta: '{}' } as never
      yield { type: 'block-end', index: 0, block: { type: 'tool-call', id: 'call_A', name: 'spy', arguments: '{}' } } as never
      yield { type: 'finish', reason: { kind: 'tool-calls' } } as never
      return
    }
    yield { type: 'text-delta', index: 0, text: 'done' } as never
    yield { type: 'block-end', index: 0, block: { type: 'text', text: 'done' } } as never
    yield { type: 'finish', reason: { kind: 'stop' } } as never
  }
}

async function createHarness(adapter: ProbeAdapter, execute: () => void) {
  const ctx = new Context()
  for (const plugin of [SessionStore, SessionProjectionRegistry, LlmRuntime, AgentRegistry, SystemPrompt, ToolRuntime]) await ctx.plugin(plugin)
  await ctx.plugin(sentinel)
  await ctx.plugin(retry)
  ctx.llm.registerAdapter(['probe'], adapter)
  const spyTool: ToolDefinition = {
    name: 'spy',
    description: 'test spy',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    output: {
      schema: { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'], additionalProperties: false },
      render: () => [{ type: 'text', text: 'ok' }],
    },
    execute: async () => { execute(); return { ok: true } },
  }
  ctx.tools.register(spyTool)
  await ctx.plugin(AgentLoop)
  const handle = await ctx.agents.create({ sessionId: SessionId(`probe-${adapter.calls}-${Date.now()}`), agentOptions: { provider: 'probe', model: 'probe-model' } })
  return { ctx, handle }
}

describe('real AgentLoop integration', () => {
  it('[TP-049] blocks a malformed tool stream before the real tool runtime', async () => {
    const adapter = new ProbeAdapter('corrupt')
    let executions = 0
    const { ctx, handle } = await createHarness(adapter, () => { executions += 1 })
    try {
      handle.agent.followup(createUserMessage({ content: [{ type: 'text', text: 'run' }], source: { kind: 'plugin', plugin: 'd3-test' } }))
      await handle.agent.whenIdle()
      const attempts = handle.agent.session.snapshotEvents().filter(event => event.type === 'assistant/attempt')
      expect(executions).toBe(0)
      expect(adapter.calls).toBe(1)
      expect(attempts).toHaveLength(1)
      const last = attempts[0]?.data.stream.at(-1)
      expect(last?.type).toBe('chunk')
      if (last?.type === 'chunk') expect(last.chunk).toMatchObject({
          type: 'finish',
          reason: { kind: 'error', failure: { code: 'STREAM_INTEGRITY_VIOLATION' } },
        })
    } finally {
      await handle.dispose()
      await ctx.fiber.dispose()
    }
  })

  it('[TP-049] allows a valid tool call through the real tool runtime', async () => {
    const adapter = new ProbeAdapter('healthy')
    let executions = 0
    const { ctx, handle } = await createHarness(adapter, () => { executions += 1 })
    try {
      handle.agent.followup(createUserMessage({ content: [{ type: 'text', text: 'run' }], source: { kind: 'plugin', plugin: 'd3-test' } }))
      await handle.agent.whenIdle()
      expect(executions).toBe(1)
      expect(adapter.calls).toBe(2)
    } finally {
      await handle.dispose()
      await ctx.fiber.dispose()
    }
  })

  it('[TP-038] lets user cancellation win over integrity reporting in the real AgentLoop', async () => {
    const adapter = new ProbeAdapter('abort')
    let executions = 0
    const { ctx, handle } = await createHarness(adapter, () => { executions += 1 })
    try {
      handle.agent.followup(createUserMessage({ content: [{ type: 'text', text: 'run' }], source: { kind: 'plugin', plugin: 'd3-test' } }))
      await adapter.entered.promise
      handle.agent.cancel({ kind: 'user' })
      await handle.agent.whenIdle()
      const errorChunks = handle.agent.session.snapshotEvents()
        .filter(event => event.type === 'assistant/attempt')
        .flatMap(event => event.data.stream)
        .filter(record => record.type === 'chunk' && record.chunk.type === 'finish' && record.chunk.reason.kind === 'error')
      expect(executions).toBe(0)
      expect(adapter.calls).toBe(1)
      expect(errorChunks).toHaveLength(0)
    } finally {
      await handle.dispose()
      await ctx.fiber.dispose()
    }
  })

  it('[TP-044/TP-045] shows always retry is explicit and still cannot execute the quarantined tool', async () => {
    const adapter = new ProbeAdapter('always-recover', {
      mode: 'always',
      initialDelayMs: 1,
      maxDelayMs: 1,
      jitterRatio: 0,
    })
    let executions = 0
    const { ctx, handle } = await createHarness(adapter, () => { executions += 1 })
    try {
      handle.agent.followup(createUserMessage({ content: [{ type: 'text', text: 'run' }], source: { kind: 'plugin', plugin: 'd3-test' } }))
      await handle.agent.whenIdle()
      const events = handle.agent.session.snapshotEvents()
      const retries = events.filter(event => event.type === 'llm/retry')
      expect(executions).toBe(0)
      expect(adapter.calls).toBe(2)
      expect(retries).toHaveLength(1)
      expect(retries[0]?.data.mode).toBe('always')
      expect(retries[0]?.data.failure.code).toBe('STREAM_INTEGRITY_VIOLATION')
    } finally {
      await handle.dispose()
      await ctx.fiber.dispose()
    }
  })
})
