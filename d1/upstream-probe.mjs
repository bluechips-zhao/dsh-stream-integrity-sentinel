/**
 * D1 probe for the public DSH LLM seam.
 *
 * Run with Node 22+ and DSH_PROBE_MODULE_ROOT pointing at an installed,
 * published DSH dependency closure. The default is the verified local
 * closure used during the 2026-09-15 preflight.
 */

import { strict as assert } from 'node:assert'
import { pathToFileURL } from 'node:url'

const moduleRoot = process.env.DSH_PROBE_MODULE_ROOT
  ?? 'I:/Codex/dsh-readset-guard/node_modules'

const load = (relativePath) => import(pathToFileURL(`${moduleRoot}/${relativePath}`).href)
const { Context } = await load('@deepseek-ai/cordis/lib/index.js')
const { default: LlmRuntime, LlmAdapter } = await load('@deepseek-ai/dsh-llm/lib/index.js')

class ProbeAdapter extends LlmAdapter {
  calls = 0

  providerInfo(provider) {
    return { id: provider, name: provider }
  }

  async resolveModel(provider, model) {
    return { provider, id: model, name: model }
  }

  async *stream(options) {
    this.calls += 1
    if (options.model === 'throw') throw new Error('synthetic adapter failure')
    yield { type: 'text-delta', index: 0, text: 'ok' }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

const makeRuntime = () => {
  const ctx = new Context()
  const llm = new LlmRuntime(ctx)
  const adapter = new ProbeAdapter()
  llm.registerAdapter(['probe'], adapter)
  return { ctx, llm, adapter }
}

const collect = async (iterable) => {
  const chunks = []
  for await (const chunk of iterable) chunks.push(chunk)
  return chunks
}

const options = (model = 'model') => ({
  provider: 'probe',
  model,
  messages: [],
  tools: [{ name: 'probe', description: 'probe', parameters: {} }],
})

const basic = makeRuntime()
const basicEvents = []
const basicSeen = []
let nextCalls = 0
const add = (label, listenerOptions) => basic.ctx.on('llm/stream', function (request, next) {
  basicEvents.push(`${label}:enter`)
  basicSeen.push({
    label,
    requestIsCurrent: request === currentRequest,
    thisKind: typeof this,
    thisConstructor: this?.constructor?.name,
    thisServiceName: this?.name,
    nextType: typeof next,
    nextArity: next.length,
  })
  nextCalls += 1
  const downstream = next()
  return (async function* () {
    for await (const chunk of downstream) {
      basicEvents.push(`${label}:yield:${chunk.type}`)
      yield chunk
    }
  })()
}, listenerOptions)

let currentRequest = options()
const disposeA = add('A')
const disposeB = add('B')
const basicOutput = await collect(basic.llm.stream(currentRequest))
assert.equal(basic.adapter.calls, 1)
assert.equal(nextCalls, 2)
assert.deepEqual(basicEvents, [
  'A:enter', 'B:enter',
  'B:yield:text-delta', 'A:yield:text-delta',
  'B:yield:finish', 'A:yield:finish',
])
assert.equal(basicSeen.every(item => item.requestIsCurrent), true)
assert.equal(basicSeen.every(item => item.nextType === 'function' && item.nextArity === 0), true)
assert.deepEqual(basicOutput, [
  { type: 'text-delta', index: 0, text: 'ok' },
  { type: 'finish', reason: { kind: 'stop' } },
])

disposeB()
basicEvents.length = 0
await collect(basic.llm.stream(options('after-dispose')))
assert.deepEqual(basicEvents, ['A:enter', 'A:yield:text-delta', 'A:yield:finish'])
disposeA()

const errorRuntime = makeRuntime()
const errorOutput = await collect(errorRuntime.llm.stream(options('throw')))
assert.deepEqual(errorOutput, [{
  type: 'finish',
  reason: { kind: 'error', failure: { message: 'synthetic adapter failure', code: 'UNKNOWN' } },
}])

const prependRuntime = makeRuntime()
const prependEvents = []
const record = (label, listenerOptions) => prependRuntime.ctx.on('llm/stream', function (_request, next) {
  prependEvents.push(`${label}:enter`)
  const downstream = next()
  return (async function* () {
    for await (const chunk of downstream) {
      prependEvents.push(`${label}:yield:${chunk.type}`)
      yield chunk
    }
  })()
}, listenerOptions)
record('existing', undefined)
record('sentinel', { prepend: true })
record('later-prepend', { prepend: true })
await collect(prependRuntime.llm.stream(options()))
assert.deepEqual(prependEvents.slice(0, 3), [
  'later-prepend:enter', 'sentinel:enter', 'existing:enter',
])
assert.equal(prependEvents.includes('existing:yield:text-delta'), true)

console.log(JSON.stringify({
  status: 'PASS',
  node: process.version,
  moduleRoot,
  checks: {
    signatureAndContext: basicSeen,
    nextCalledOncePerListener: nextCalls === 3,
    outerToInnerEntryAndInnerToOuterYield: basicOutput.length === 2,
    disposerRemovesListener: true,
    adapterFailureNormalized: errorOutput[0]?.reason?.kind === 'error',
    prependOrder: prependEvents,
    laterPrependIsOuterBoundary: true,
  },
}, null, 2))
