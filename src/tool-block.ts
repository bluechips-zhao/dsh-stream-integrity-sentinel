import { violation } from './diagnostics.js'
import type { RuleId, StreamChunk, Violation } from './types.js'

export interface ToolBlockState {
  readonly index: number
  readonly type: 'tool-call'
  id?: string
  name?: string
  arguments: string
  argumentsBytes: number
  closed: boolean
}

const encoder = new TextEncoder()
export const utf8Bytes = (value: string): number => encoder.encode(value).byteLength

export function createToolBlock(index: number): ToolBlockState {
  return { index, type: 'tool-call', arguments: '', argumentsBytes: 0, closed: false }
}

export function acceptToolDelta(state: ToolBlockState, chunk: StreamChunk, maxArgumentsBytes: number): Violation | undefined {
  if (state.closed) return violation('SIS_STRAGGLER', state.index)
  const id = chunk.id
  if (typeof id !== 'string' || id.trim().length === 0) return violation('SIS_TOOL_ID_EMPTY', state.index)
  if (state.id === undefined) state.id = id
  else if (state.id !== id) return violation('SIS_TOOL_ID_CHANGED', state.index)

  if (chunk.name !== undefined) {
    if (typeof chunk.name !== 'string') return violation('SIS_CHUNK_SHAPE', state.index)
    if (chunk.name.length > 0) {
      if (state.name === undefined) state.name = chunk.name
      else if (state.name !== chunk.name) return violation('SIS_TOOL_NAME_CHANGED', state.index)
    }
  }
  if (typeof chunk.argumentsDelta !== 'string') return violation('SIS_CHUNK_SHAPE', state.index)
  const addedBytes = utf8Bytes(chunk.argumentsDelta)
  if (state.argumentsBytes + addedBytes > maxArgumentsBytes) {
    return violation('SIS_LIMIT_EXCEEDED', state.index, state.argumentsBytes + addedBytes, 'arguments')
  }
  state.arguments += chunk.argumentsDelta
  state.argumentsBytes += addedBytes
  return undefined
}

function field(block: Record<string, unknown>, key: string, index: number): string | Violation {
  const value = block[key]
  if (typeof value !== 'string' || value.trim().length === 0) return violation(key === 'id' ? 'SIS_TOOL_ID_EMPTY' : 'SIS_TOOL_NAME_MISSING', index)
  return value
}

export function closeToolBlock(state: ToolBlockState, block: Record<string, unknown>): Violation | undefined {
  if (state.closed) return violation('SIS_BLOCK_END_DUPLICATE', state.index)
  const id = field(block, 'id', state.index)
  if (typeof id !== 'string') return id
  const name = field(block, 'name', state.index)
  if (typeof name !== 'string') return name
  if (typeof block.arguments !== 'string') return violation('SIS_CHUNK_SHAPE', state.index)
  try { JSON.parse(block.arguments) } catch { return violation('SIS_ARGUMENTS_INVALID_JSON', state.index) }
  if (state.id !== undefined && state.id !== id) return violation('SIS_BLOCK_END_MISMATCH', state.index)
  if (state.name !== undefined && state.name !== name) return violation('SIS_BLOCK_END_MISMATCH', state.index)
  if (state.arguments !== block.arguments) return violation('SIS_BLOCK_END_MISMATCH', state.index)
  state.id = id
  state.name = name
  state.closed = true
  return undefined
}

export function validateCompleteTool(state: ToolBlockState): Violation | undefined {
  if (!state.closed || state.id === undefined || state.id.trim().length === 0) return violation('SIS_TOOL_ID_EMPTY', state.index)
  if (state.name === undefined || state.name.trim().length === 0) return violation('SIS_TOOL_NAME_MISSING', state.index)
  try { JSON.parse(state.arguments) } catch { return violation('SIS_ARGUMENTS_INVALID_JSON', state.index) }
  return undefined
}

export function toolBlockFromEnd(index: number, block: Record<string, unknown>, maxArgumentsBytes: number): ToolBlockState | Violation {
  const state = createToolBlock(index)
  const id = field(block, 'id', index)
  if (typeof id !== 'string') return id
  const name = field(block, 'name', index)
  if (typeof name !== 'string') return name
  if (typeof block.arguments !== 'string') return violation('SIS_CHUNK_SHAPE', index)
  if (utf8Bytes(block.arguments) > maxArgumentsBytes) return violation('SIS_LIMIT_EXCEEDED', index, utf8Bytes(block.arguments), 'arguments')
  state.id = id
  state.name = name
  state.arguments = block.arguments
  state.argumentsBytes = utf8Bytes(block.arguments)
  state.closed = true
  try { JSON.parse(state.arguments) } catch { return violation('SIS_ARGUMENTS_INVALID_JSON', index) }
  return state
}
