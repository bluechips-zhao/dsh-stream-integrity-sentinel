import { describe, expect, it } from 'vitest'
import { normalizeConfig } from '../src/config.js'
import { guardStream } from '../src/guard-stream.js'

const valid = (argumentsText: string): Record<string, unknown>[] => [
  { type: 'block-start', index: 0, blockType: 'tool-call' },
  { type: 'tool-call-delta', index: 0, id: 'call_A', name: 'tool_a', argumentsDelta: argumentsText.slice(0, 1) },
  { type: 'tool-call-delta', index: 0, id: 'call_A', argumentsDelta: argumentsText.slice(1) },
  { type: 'block-end', index: 0, block: { type: 'tool-call', id: 'call_A', name: 'tool_a', arguments: argumentsText } },
  { type: 'finish', reason: { kind: 'tool-calls' } },
]

async function collect(chunks: unknown[], mode: 'enforce' | 'observe' = 'enforce') {
  const output = []
  for await (const chunk of guardStream({
    async *[Symbol.asyncIterator]() { for (const chunk of chunks) yield chunk },
  }, normalizeConfig({ mode }))) output.push(chunk)
  return output
}

describe('deterministic property and fuzz checks', () => {
  it('[P-001/P-005] preserves every valid argument partition and chunk reference', async () => {
    let seed = 0x5eed
    for (let run = 0; run < 64; run += 1) {
      seed = (seed * 1664525 + 1013904223) >>> 0
      const value = JSON.stringify({ n: seed % 1000, ok: true })
      const chunks = valid(value)
      const split = 1 + (seed % (value.length - 1))
      chunks[1] = { ...chunks[1], argumentsDelta: value.slice(0, split) }
      chunks[2] = { ...chunks[2], argumentsDelta: value.slice(split) }
      const output = await collect(chunks)
      expect(output).toEqual(chunks)
      expect(output.every((chunk, index) => chunk === chunks[index])).toBe(true)
    }
  })

  it('[TP-046] keeps concurrent stream state isolated', async () => {
    const first = valid('{"stream":"first"}')
    const second = valid('{"stream":"second"}')
    const [firstOutput, secondOutput] = await Promise.all([collect(first), collect(second)])
    expect(firstOutput).toEqual(first)
    expect(secondOutput).toEqual(second)
    expect(firstOutput.every((chunk, index) => chunk === first[index])).toBe(true)
    expect(secondOutput.every((chunk, index) => chunk === second[index])).toBe(true)
  })

  it('[P-003] never emits quarantined input after a generated violation', async () => {
    let seed = 17
    for (let run = 0; run < 64; run += 1) {
      seed = (seed * 1103515245 + 12345) >>> 0
      const chunks = valid('{}')
      const bad = { ...chunks[1], id: `call_${seed}` }
      chunks[2] = { ...chunks[2], id: 'call_other' }
      chunks.splice(1, 1, bad)
      const output = await collect(chunks)
      expect(output).toHaveLength(1)
      expect(output[0]).toMatchObject({ type: 'finish', reason: { kind: 'error' } })
      expect(output.some(chunk => chunk === chunks[2])).toBe(false)
    }
  })

  it('[P-004/TP-041] observe remains total over arbitrary JSON-shaped chunk values', async () => {
    const values = [null, [], {}, { type: 'unknown', payload: 'x' }, { type: 'finish', reason: { kind: 'stop' } }]
    const output = await collect(values, 'observe')
    expect(output).toEqual(values)
  })
})
