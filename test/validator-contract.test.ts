import { describe, expect, it } from 'vitest'
import { normalizeConfig } from '../src/config.js'
import { StreamValidator } from '../src/validator.js'

const finish = (kind: string, extra: Record<string, unknown> = {}) => ({ type: 'finish', reason: { kind, ...extra } })
const usage = { type: 'usage', usage: { inputTokens: 1, outputTokens: 1 } }
const toolDelta = (id: string, extra: Record<string, unknown> = {}) => ({
  type: 'tool-call-delta',
  index: 0,
  id,
  name: 'tool_a',
  argumentsDelta: '{}',
  ...extra,
})
const toolEnd = (extra: Record<string, unknown> = {}) => ({
  type: 'block-end',
  index: 0,
  block: { type: 'tool-call', id: 'call_A', name: 'tool_a', arguments: '{}', ...extra },
})

function firstRule(chunks: readonly unknown[], config = normalizeConfig()): string | undefined {
  const validator = new StreamValidator(config)
  for (const chunk of chunks) {
    const result = validator.push(chunk)
    if (result.violation !== undefined) return result.violation.rule
  }
  return validator.finish()?.rule
}

describe('direct normalized stream grammar contracts', () => {
  it.each([
    ['TP-011 null chunk', [null], 'SIS_CHUNK_SHAPE'],
    ['TP-011 array chunk', [[]], 'SIS_CHUNK_SHAPE'],
    ['TP-012 negative index', [{ type: 'text-delta', index: -1, text: '' }], 'SIS_INDEX_INVALID'],
    ['TP-012 non-integer index', [{ type: 'text-delta', index: 1.5, text: '' }], 'SIS_INDEX_INVALID'],
    ['TP-012 non-finite index', [{ type: 'text-delta', index: Number.NaN, text: '' }], 'SIS_INDEX_INVALID'],
    ['TP-012 unsafe index', [{ type: 'text-delta', index: Number.MAX_SAFE_INTEGER + 1, text: '' }], 'SIS_INDEX_INVALID'],
    ['TP-013 text then tool at one index', [
      { type: 'text-delta', index: 0, text: 'x' },
      toolDelta('call_A'),
    ], 'SIS_BLOCK_TYPE_CONFLICT'],
    ['TP-014 duplicate block start', [
      { type: 'block-start', index: 0, blockType: 'text' },
      { type: 'block-start', index: 0, blockType: 'text' },
    ], 'SIS_BLOCK_START_DUPLICATE'],
    ['TP-015 duplicate block end', [
      { type: 'block-end', index: 0, block: { type: 'text', text: 'x' } },
      { type: 'block-end', index: 0, block: { type: 'text', text: 'x' } },
    ], 'SIS_BLOCK_END_DUPLICATE'],
    ['TP-016 delta after closed block', [
      { type: 'block-end', index: 0, block: { type: 'text', text: 'x' } },
      { type: 'text-delta', index: 0, text: 'late' },
    ], 'SIS_STRAGGLER'],
    ['TP-017 chunk after finish', [
      finish('stop'),
      { type: 'text-delta', index: 0, text: 'late' },
    ], 'SIS_AFTER_FINISH'],
    ['TP-018 missing finish', [], 'SIS_FINISH_MISSING'],
    ['TP-019 duplicate finish', [finish('stop'), finish('stop')], 'SIS_FINISH_DUPLICATE'],
    ['TP-020 duplicate usage', [usage, usage], 'SIS_USAGE_DUPLICATE'],
    ['TP-022 changing tool id', [toolDelta('call_A'), toolDelta('call_B')], 'SIS_TOOL_ID_CHANGED'],
    ['TP-024 missing tool name', [toolEnd({ name: undefined })], 'SIS_TOOL_NAME_MISSING'],
    ['TP-027 block-end mismatch', [
      toolDelta('call_A'),
      toolEnd({ arguments: '{"x":1}' }),
    ], 'SIS_BLOCK_END_MISMATCH'],
    ['TP-028 tool block with stop finish', [toolEnd(), finish('stop')], 'SIS_FINISH_TOOL_MISMATCH'],
    ['TP-029 tool-calls finish without tool block', [finish('tool-calls')], 'SIS_FINISH_TOOL_MISMATCH'],
    ['TP-030 invalid end-only arguments', [toolEnd({ arguments: '{' })], 'SIS_ARGUMENTS_INVALID_JSON'],
    ['TP-032 replay block count mismatch', [
      { type: 'block-end', index: 0, block: { type: 'text', text: 'x' } },
      { ...finish('stop'), replayState: { response: {}, blocks: [] } },
    ], 'SIS_REPLAY_STATE_INVALID'],
  ] as const)('%s', (_name, chunks, expected) => {
    expect(firstRule(chunks)).toBe(expected)
  })
})
