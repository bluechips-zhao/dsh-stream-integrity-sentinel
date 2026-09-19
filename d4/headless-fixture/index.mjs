import { LlmAdapter } from '@deepseek-ai/dsh-llm'

class HeadlessProbeAdapter extends LlmAdapter {
  calls = 0

  providerRetryPolicy() {
    if (process.env.D4_RETRY_MODE !== 'always') return undefined
    return { mode: 'always', initialDelayMs: 1, maxDelayMs: 1, jitterRatio: 0 }
  }

  async *stream(options) {
    this.calls += 1
    process.stderr.write(`D4_ADAPTER_CALLS_${this.calls}\n`)
    if (process.env.D4_STREAM_MODE === 'abort') {
      yield { type: 'block-start', index: 0, blockType: 'tool-call' }
      yield { type: 'tool-call-delta', index: 0, id: 'call_A', name: 'd4-spy', argumentsDelta: '{}' }
      await new Promise(resolve => {
        if (options.signal?.aborted) resolve()
        else options.signal?.addEventListener('abort', resolve, { once: true })
      })
      return
    }
    if (process.env.D4_STREAM_MODE === 'violation'
      || (process.env.D4_STREAM_MODE === 'always-recover' && this.calls === 1)) {
      yield { type: 'block-start', index: 0, blockType: 'tool-call' }
      yield { type: 'tool-call-delta', index: 0, id: 'call_A', name: 'd4-spy', argumentsDelta: '{}' }
      yield { type: 'tool-call-delta', index: 0, id: 'call_B', name: 'd4-spy', argumentsDelta: '' }
      return
    }
    yield { type: 'text-delta', index: 0, text: 'd4-headless-ok' }
    yield { type: 'block-end', index: 0, block: { type: 'text', text: 'd4-headless-ok' } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

export const name = 'dsh-sis-d4-headless-fixture'
export const inject = ['llm', 'tools']

export function apply(ctx) {
  ctx.llm.registerAdapter(['d4-probe'], new HeadlessProbeAdapter())
  ctx.tools.register({
    name: 'd4-spy',
    description: 'D4 in-process execution counter',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    output: {
      schema: { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'], additionalProperties: false },
      render: () => [{ type: 'text', text: 'd4-spy-ok' }],
    },
    execute: async () => {
      process.stderr.write('D4_SPY_EXECUTED\n')
      return { ok: true }
    },
  })
  ctx.on('agent/request', (payload, next) => next().then(request => ({ ...request, provider: 'd4-probe', model: 'd4-model' })))
}
