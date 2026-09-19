import { describe, expect, it } from 'vitest'
import { normalizeConfig, routeIncluded } from '../src/config.js'
import { guardStream } from '../src/guard-stream.js'

const finish = (kind: string, extra: Record<string, unknown> = {}) => ({ type: 'finish', reason: { kind, ...extra } })
const toolStream = (tailFinish = finish('tool-calls')) => [
  { type: 'text-delta', index: 0, text: 'prefix' },
  { type: 'block-end', index: 0, block: { type: 'text', text: 'prefix' } },
  { type: 'block-start', index: 1, blockType: 'tool-call' },
  { type: 'tool-call-delta', index: 1, id: 'call_A', name: 'tool_a', argumentsDelta: '{"x":' },
  { type: 'tool-call-delta', index: 1, id: 'call_A', argumentsDelta: '1}' },
  { type: 'block-end', index: 1, block: { type: 'tool-call', id: 'call_A', name: 'tool_a', arguments: '{"x":1}' } },
  tailFinish,
]

const iterable = (chunks: unknown[], hooks: { next?: () => void, returned?: () => void } = {}): AsyncIterable<unknown> => ({
  [Symbol.asyncIterator]() {
    let index = 0
    return {
      async next() {
        hooks.next?.()
        return index < chunks.length ? { done: false, value: chunks[index++] } : { done: true, value: undefined }
      },
      async return() {
        hooks.returned?.()
        return { done: true, value: undefined }
      },
    }
  },
})

describe('config', () => {
  it('defaults and freezes bounded configuration', () => {
    const config = normalizeConfig()
    expect(config.mode).toBe('enforce')
    expect(config.maxQuarantineBytes).toBe(4 * 1024 * 1024)
    expect(Object.isFrozen(config)).toBe(true)
    expect(() => normalizeConfig({ unknown: true })).toThrow()
    expect(() => normalizeConfig({ maxBlocksPerCall: 0 })).toThrow()
  })

  it('[TP-002] applies include then exclude exact matching', () => {
    const config = normalizeConfig({ includeProviders: ['p'], excludeModels: ['blocked'] })
    expect(routeIncluded(config, 'p', 'm')).toBe(true)
    expect(routeIncluded(config, 'q', 'm')).toBe(false)
    expect(routeIncluded(config, 'p', 'blocked')).toBe(false)
  })
})

describe('guardStream', () => {
  it('[TP-005] passes a healthy tool stream by reference only after upstream done', async () => {
    const chunks = toolStream()
    let nextCalls = 0
    const output: unknown[] = []
    const iterator = guardStream(iterable(chunks, { next: () => { nextCalls += 1 } }), normalizeConfig())
    output.push((await iterator.next()).value)
    expect(nextCalls).toBe(1)
    while (true) {
      const step = await iterator.next()
      if (step.done) break
      output.push(step.value)
    }
    expect(output).toEqual(chunks)
    expect(output[0]).toBe(chunks[0])
    expect(output[output.length - 1]).toBe(chunks[chunks.length - 1])
    expect(nextCalls).toBe(chunks.length + 1)
  })

  it('[TP-003/TP-004] passes a healthy text and reasoning prefix without changing timing or references', async () => {
    const chunks = [
      { type: 'reasoning-delta', index: 0, text: 'think' },
      { type: 'text-delta', index: 1, text: 'answer' },
      { type: 'block-end', index: 0, block: { type: 'reasoning', text: 'think' } },
      { type: 'block-end', index: 1, block: { type: 'text', text: 'answer' } },
      finish('stop'),
    ]
    let nextCalls = 0
    const output = []
    for await (const chunk of guardStream(iterable(chunks, { next: () => { nextCalls += 1 } }), normalizeConfig())) output.push(chunk)
    expect(output).toEqual(chunks)
    expect(output.every((chunk, index) => chunk === chunks[index])).toBe(true)
    expect(nextCalls).toBe(chunks.length + 1)
  })

  it('[TP-007] accepts a delta-only healthy tool stream', async () => {
    const chunks = [
      { type: 'tool-call-delta', index: 0, id: 'call_A', name: 'tool_a', argumentsDelta: '{"x":1}' },
      { type: 'block-end', index: 0, block: { type: 'tool-call', id: 'call_A', name: 'tool_a', arguments: '{"x":1}' } },
      finish('tool-calls'),
    ]
    const output = []
    for await (const chunk of guardStream(iterable(chunks), normalizeConfig())) output.push(chunk)
    expect(output).toEqual(chunks)
    expect(output[0]).toBe(chunks[0])
  })

  it('[TP-008] accepts a healthy end-only tool block', async () => {
    const chunks = [
      { type: 'block-end', index: 0, block: { type: 'tool-call', id: 'call_A', name: 'tool_a', arguments: '[]' } },
      finish('tool-calls'),
    ]
    const output = []
    for await (const chunk of guardStream(iterable(chunks), normalizeConfig())) output.push(chunk)
    expect(output).toEqual(chunks)
  })

  it('[TP-006] passes interleaved healthy tool blocks with unique identities', async () => {
    const chunks = [
      { type: 'block-start', index: 0, blockType: 'tool-call' },
      { type: 'block-start', index: 1, blockType: 'tool-call' },
      { type: 'tool-call-delta', index: 0, id: 'call_A', name: 'tool_a', argumentsDelta: '{"a":1}' },
      { type: 'tool-call-delta', index: 1, id: 'call_B', name: 'tool_b', argumentsDelta: '[true]' },
      { type: 'block-end', index: 0, block: { type: 'tool-call', id: 'call_A', name: 'tool_a', arguments: '{"a":1}' } },
      { type: 'block-end', index: 1, block: { type: 'tool-call', id: 'call_B', name: 'tool_b', arguments: '[true]' } },
      finish('tool-calls'),
    ]
    const output = []
    for await (const chunk of guardStream(iterable(chunks), normalizeConfig())) output.push(chunk)
    expect(output).toEqual(chunks)
    expect(output.at(-1)).toBe(chunks.at(-1))
  })

  it('[TP-009] allows a tool name only on the first non-empty delta', async () => {
    const chunks = [
      { type: 'tool-call-delta', index: 0, id: 'call_A', name: 'tool_a', argumentsDelta: '{}' },
      { type: 'tool-call-delta', index: 0, id: 'call_A', argumentsDelta: '' },
      { type: 'tool-call-delta', index: 0, id: 'call_A', name: '', argumentsDelta: '' },
      { type: 'block-end', index: 0, block: { type: 'tool-call', id: 'call_A', name: 'tool_a', arguments: '{}' } },
      finish('tool-calls'),
    ]
    const output = []
    for await (const chunk of guardStream(iterable(chunks), normalizeConfig())) output.push(chunk)
    expect(output).toEqual(chunks)
  })

  it.each(['null', '[]', '{"ok":true}'])('[TP-010] accepts valid JSON root %s as tool arguments', async argumentsText => {
    const chunks = [
      { type: 'block-end', index: 0, block: { type: 'tool-call', id: `call_${argumentsText}`, name: 'tool_a', arguments: argumentsText } },
      finish('tool-calls'),
    ]
    const output = []
    for await (const chunk of guardStream(iterable(chunks), normalizeConfig())) output.push(chunk)
    expect(output).toEqual(chunks)
  })

  it('[TP-021] rejects an empty tool id and never releases the tool tail', async () => {
    const diagnostics: unknown[] = []
    const chunks = [
      { type: 'tool-call-delta', index: 0, id: ' ', name: 'tool_a', argumentsDelta: '{}' },
      finish('tool-calls'),
    ]
    const output = []
    for await (const chunk of guardStream(iterable(chunks), normalizeConfig(), { provider: 'p', model: 'm' }, item => diagnostics.push(item))) output.push(chunk)
    const first = output[0] as { reason?: { failure?: { code?: string, message?: string } } }
    expect(output).toHaveLength(1)
    expect(first.reason?.failure?.code).toBe('STREAM_INTEGRITY_VIOLATION')
    expect(first.reason?.failure?.message).not.toContain('{}')
    expect(diagnostics).toEqual([{ rule: 'SIS_TOOL_ID_EMPTY', index: 0 }])
  })

  it('[TP-023] rejects duplicate tool ids when a tool block first appears at block-end', async () => {
    const chunks = [
      { type: 'tool-call-delta', index: 0, id: 'call_same', name: 'first', argumentsDelta: '{"x":1}' },
      { type: 'block-end', index: 0, block: { type: 'tool-call', id: 'call_same', name: 'first', arguments: '{"x":1}' } },
      { type: 'block-end', index: 1, block: { type: 'tool-call', id: 'call_same', name: 'second', arguments: '{"x":2}' } },
      finish('tool-calls'),
    ]
    const output = []
    for await (const chunk of guardStream(iterable(chunks), normalizeConfig())) output.push(chunk)
    const last = output.at(-1) as { reason?: { failure?: { message?: string } } }
    expect(last.reason?.failure?.message).toContain('SIS_TOOL_ID_DUPLICATE')
  })

  it('[TP-025/P-002/P-007] locks the first rule and closes the iterator on a tail violation', async () => {
    let returned = 0
    const chunks = [
      { type: 'tool-call-delta', index: 0, id: 'call_A', name: 'tool_a', argumentsDelta: '{}' },
      { type: 'tool-call-delta', index: 0, id: 'call_A', name: 'tool_b', argumentsDelta: '' },
      finish('tool-calls'),
    ]
    const diagnostics: unknown[] = []
    const output = []
    for await (const chunk of guardStream(iterable(chunks, { returned: () => { returned += 1 } }), normalizeConfig(), {}, item => diagnostics.push(item))) output.push(chunk)
    expect(output).toHaveLength(1)
    expect(diagnostics[0]).toMatchObject({ rule: 'SIS_TOOL_NAME_CHANGED', index: 0 })
    expect(returned).toBe(1)
  })

  it('[TP-031] suppresses a non-success tool tail without converting it to success', async () => {
    const failure = { message: 'upstream failed', code: 'SERVER' }
    const chunks = toolStream(finish('error', { failure }))
    const output = []
    for await (const chunk of guardStream(iterable(chunks), normalizeConfig())) output.push(chunk)
    expect(output).toEqual([chunks[0], chunks[1], { type: 'finish', reason: { kind: 'error', failure } }])
  })

  it('[TP-031] passes aligned replay state only on a successful tool finish', async () => {
    const chunks = toolStream()
    chunks[chunks.length - 1] = { type: 'finish', reason: { kind: 'tool-calls' }, replayState: { response: { opaque: true }, blocks: [{}, {}] } } as never
    const output = []
    for await (const chunk of guardStream(iterable(chunks), normalizeConfig())) output.push(chunk)
    expect(output).toEqual(chunks)
  })

  it('[TP-031] rejects replay state on a non-success finish', async () => {
    const chunks = toolStream()
    chunks[chunks.length - 1] = { type: 'finish', reason: { kind: 'error', failure: { code: 'SERVER', message: 'failed' } }, replayState: { response: { opaque: true }, blocks: [{}, {}] } } as never
    const diagnostics: unknown[] = []
    const output = []
    for await (const chunk of guardStream(iterable(chunks), normalizeConfig(), {}, item => diagnostics.push(item))) output.push(chunk)
    expect(output).toHaveLength(3)
    expect(output.at(-1)).toMatchObject({ type: 'finish', reason: { kind: 'error', failure: { code: 'STREAM_INTEGRITY_VIOLATION' } } })
    expect(diagnostics).toEqual([{ rule: 'SIS_REPLAY_STATE_INVALID' }])
  })

  it('rejects an error finish without structured failure facts', async () => {
    const output = []
    for await (const chunk of guardStream(iterable([finish('error')]), normalizeConfig())) output.push(chunk)
    expect(output).toEqual([{ type: 'finish', reason: { kind: 'error', failure: expect.objectContaining({ code: 'STREAM_INTEGRITY_VIOLATION' }) } }])
  })

  it('passes unknown non-tool blocks as opaque lifecycle values', async () => {
    const chunks = [
      { type: 'block-start', index: 0, blockType: 'future-block' },
      { type: 'block-end', index: 0, block: { type: 'future-block', opaque: 'value' } },
      finish('stop'),
    ]
    const output = []
    for await (const chunk of guardStream(iterable(chunks), normalizeConfig())) output.push(chunk)
    expect(output).toEqual(chunks)
    expect(output[0]).toBe(chunks[0])
    expect(output[1]).toBe(chunks[1])
  })

  it('[TP-026/TP-041] keeps observe mode byte-for-byte and reports without blocking', async () => {
    const chunks = [
      { type: 'tool-call-delta', index: 0, id: 'call_A', name: 'tool_a', argumentsDelta: '{' },
      { type: 'block-end', index: 0, block: { type: 'tool-call', id: 'call_A', name: 'tool_a', arguments: '{' } },
      finish('tool-calls'),
    ]
    const diagnostics: unknown[] = []
    const output = []
    for await (const chunk of guardStream(iterable(chunks), normalizeConfig({ mode: 'observe' }), {}, item => diagnostics.push(item))) output.push(chunk)
    expect(output).toEqual(chunks)
    expect(diagnostics[0]).toEqual({ rule: 'SIS_ARGUMENTS_INVALID_JSON', index: 0 })
    expect(output).toEqual(chunks)
  })

  it('[TP-041] reports only the first observe violation plus a bounded summary count', async () => {
    const chunks = [null, null, finish('stop')]
    const diagnostics: unknown[] = []
    const output = []
    for await (const chunk of guardStream(iterable(chunks), normalizeConfig({ mode: 'observe' }), {}, item => diagnostics.push(item))) output.push(chunk)
    expect(output).toEqual(chunks)
    expect(diagnostics).toEqual([
      { rule: 'SIS_CHUNK_SHAPE' },
      { rule: 'SIS_CHUNK_SHAPE', count: 2, detail: 'observed-count' },
    ])
  })

  it('[TP-037] cleans up and emits nothing from quarantine after abort', async () => {
    const controller = new AbortController()
    let returned = 0
    const chunks = toolStream()
    const source = iterable(chunks, { next: () => controller.abort(), returned: () => { returned += 1 } })
    const output = []
    for await (const chunk of guardStream(source, normalizeConfig(), { signal: controller.signal })) output.push(chunk)
    expect(output).toEqual([])
    expect(returned).toBe(1)
  })

  it('[TP-038] lets abort win when it arrives with the upstream terminal finish', async () => {
    const controller = new AbortController()
    const chunks = toolStream()
    let nextCalls = 0
    let returned = 0
    const source = iterable(chunks, {
      next: () => {
        nextCalls += 1
        if (nextCalls === chunks.length + 1) controller.abort()
      },
      returned: () => { returned += 1 },
    })
    const output = []
    for await (const chunk of guardStream(source, normalizeConfig(), { signal: controller.signal })) output.push(chunk)
    expect(output).toEqual(chunks.slice(0, 2))
    expect(returned).toBe(1)
  })

  it('[TP-038] lets abort win when next resolves with a malformed chunk', async () => {
    const controller = new AbortController()
    let returned = 0
    let resolveNext: ((result: IteratorResult<unknown>) => void) | undefined
    const source: AsyncIterable<unknown> = {
      [Symbol.asyncIterator]() {
        return {
          next: () => new Promise<IteratorResult<unknown>>(resolve => { resolveNext = resolve }),
          return: async () => { returned += 1; return { done: true, value: undefined } },
        }
      },
    }
    const pending = (async () => {
      const output = []
      for await (const chunk of guardStream(source, normalizeConfig(), { signal: controller.signal })) output.push(chunk)
      return output
    })()
    await Promise.resolve()
    controller.abort()
    resolveNext?.({ done: false, value: { type: 'tool-call-delta', index: 0, id: '', name: 'tool_a', argumentsDelta: '{}' } })
    expect(await pending).toEqual([])
    expect(returned).toBe(1)
  })

  it('[TP-039] preserves the violation when iterator cleanup throws', async () => {
    const chunks = [{ type: 'tool-call-delta', index: 0, id: '', name: 'tool_a', argumentsDelta: '{}' }]
    const diagnostics: unknown[] = []
    const output = []
    for await (const chunk of guardStream(iterable(chunks, { returned: () => { throw new Error('cleanup') } }), normalizeConfig(), {}, item => diagnostics.push(item))) output.push(chunk)
    expect(output).toHaveLength(1)
    expect(output[0]).toMatchObject({ type: 'finish', reason: { kind: 'error', failure: { code: 'STREAM_INTEGRITY_VIOLATION' } } })
    expect(diagnostics).toEqual([{ rule: 'SIS_TOOL_ID_EMPTY', index: 0 }])
  })

  it('[TP-040] normalizes a source iterator failure to one internal finish', async () => {
    let returned = 0
    const source: AsyncIterable<unknown> = {
      [Symbol.asyncIterator]() {
        return {
          async next(): Promise<IteratorResult<unknown>> { throw new Error('source failure') },
          async return(): Promise<IteratorResult<unknown>> { returned += 1; return { done: true, value: undefined } },
        }
      },
    }
    const output = []
    for await (const chunk of guardStream(source, normalizeConfig())) output.push(chunk)
    expect(output).toHaveLength(1)
    expect(output[0]).toMatchObject({ type: 'finish', reason: { kind: 'error', failure: { code: 'STREAM_INTEGRITY_INTERNAL' } } })
    expect(returned).toBe(1)
  })

  it('[TP-033] fails closed at the quarantine byte limit', async () => {
    const chunks = toolStream()
    const huge = JSON.stringify('a'.repeat(70_000))
    chunks[3] = { type: 'tool-call-delta', index: 1, id: 'call_A', name: 'tool_a', argumentsDelta: huge }
    chunks[4] = { type: 'tool-call-delta', index: 1, id: 'call_A', argumentsDelta: '' }
    chunks[5] = { type: 'block-end', index: 1, block: { type: 'tool-call', id: 'call_A', name: 'tool_a', arguments: huge } }
    const config = normalizeConfig({ maxQuarantineBytes: 64 * 1024 })
    const diagnostics: unknown[] = []
    const output = []
    for await (const chunk of guardStream(iterable(chunks), config, {}, item => diagnostics.push(item))) output.push(chunk)
    const last = output.at(-1) as { reason?: { failure?: { code?: string } } }
    expect(last.reason?.failure?.code).toBe('STREAM_INTEGRITY_VIOLATION')
    expect(diagnostics).toContainEqual(expect.objectContaining({ rule: 'SIS_LIMIT_EXCEEDED' }))
  })

  it('[TP-034] fails closed when the chunk count exceeds its bound', async () => {
    const chunks = [
      ...Array.from({ length: 101 }, (_, index) => ({ type: 'text-delta', index: 0, text: String(index) })),
      finish('stop'),
    ]
    const diagnostics: unknown[] = []
    const output = []
    for await (const chunk of guardStream(iterable(chunks), normalizeConfig({ maxChunksPerCall: 100 }), {}, item => diagnostics.push(item))) output.push(chunk)
    expect(output).toHaveLength(101)
    expect(output.at(-1)).toMatchObject({ type: 'finish', reason: { kind: 'error', failure: { code: 'STREAM_INTEGRITY_VIOLATION' } } })
    expect(output).not.toContain(chunks[100])
    expect(diagnostics).toContainEqual(expect.objectContaining({ rule: 'SIS_LIMIT_EXCEEDED', detail: 'chunks' }))
  })

  it('[TP-042/P-006] stops observe analysis at a bound while preserving the full stream', async () => {
    const chunks = [
      ...Array.from({ length: 101 }, (_, index) => ({ type: 'text-delta', index: 0, text: String(index) })),
      finish('stop'),
    ]
    const diagnostics: unknown[] = []
    const output = []
    for await (const chunk of guardStream(iterable(chunks), normalizeConfig({ mode: 'observe', maxChunksPerCall: 100 }), {}, item => diagnostics.push(item))) output.push(chunk)
    expect(output).toEqual(chunks)
    expect(output.every((chunk, index) => chunk === chunks[index])).toBe(true)
    expect(diagnostics).toEqual([{ rule: 'SIS_LIMIT_EXCEEDED', count: 101, detail: 'chunks' }])
  })

  it('[TP-035] fails closed when the block count exceeds its bound', async () => {
    const chunks = [
      { type: 'text-delta', index: 0, text: 'one' },
      { type: 'block-start', index: 1, blockType: 'reasoning' },
      finish('stop'),
    ]
    const diagnostics: unknown[] = []
    const output = []
    for await (const chunk of guardStream(iterable(chunks), normalizeConfig({ maxBlocksPerCall: 1 }), {}, item => diagnostics.push(item))) output.push(chunk)
    expect(output).toHaveLength(2)
    expect(output[0]).toBe(chunks[0])
    expect(output.at(-1)).toMatchObject({ type: 'finish', reason: { kind: 'error', failure: { code: 'STREAM_INTEGRITY_VIOLATION' } } })
    expect(diagnostics).toContainEqual(expect.objectContaining({ rule: 'SIS_LIMIT_EXCEEDED', detail: 'blocks' }))
  })

  it('[TP-036] fails closed when a tool argument exceeds its byte bound', async () => {
    const tooLarge = 'a'.repeat(1025)
    const chunks = [
      { type: 'block-start', index: 0, blockType: 'tool-call' },
      { type: 'tool-call-delta', index: 0, id: 'call_A', name: 'tool_a', argumentsDelta: tooLarge },
      { type: 'block-end', index: 0, block: { type: 'tool-call', id: 'call_A', name: 'tool_a', arguments: tooLarge } },
      finish('tool-calls'),
    ]
    const diagnostics: unknown[] = []
    const output = []
    for await (const chunk of guardStream(iterable(chunks), normalizeConfig({ maxArgumentsBytesPerTool: 1024 }), {}, item => diagnostics.push(item))) output.push(chunk)
    expect(output).toHaveLength(1)
    expect(output[0]).toMatchObject({ type: 'finish', reason: { kind: 'error', failure: { code: 'STREAM_INTEGRITY_VIOLATION' } } })
    expect(diagnostics).toContainEqual(expect.objectContaining({ rule: 'SIS_LIMIT_EXCEEDED', detail: 'arguments' }))
  })
})
