import { closeToolBlock, createToolBlock, acceptToolDelta, toolBlockFromEnd, validateCompleteTool, type ToolBlockState } from './tool-block.js'
import { violation } from './diagnostics.js'
import type { RuleId, SentinelConfig, StreamChunk, Violation } from './types.js'

interface BlockState {
  readonly index: number
  readonly type: string
  closed: boolean
  readonly tool?: ToolBlockState
}

export interface ValidationResult {
  readonly violation?: Violation
  readonly toolRelated: boolean
  readonly firstSeenBlock: boolean
}

export interface ValidationSummary {
  readonly sawTool: boolean
  readonly blockCount: number
  readonly finish?: StreamChunk
  readonly finishKind?: string
  readonly blockOrder: readonly number[]
}

const CHUNK_TYPES = new Set(['block-start', 'text-delta', 'reasoning-delta', 'tool-call-delta', 'block-end', 'usage', 'finish'])
const FINISH_KINDS = new Set(['stop', 'tool-calls', 'max-tokens', 'error', 'aborted'])

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function indexOf(chunk: Record<string, unknown>): number | undefined {
  const index = chunk.index
  return Number.isSafeInteger(index) && (index as number) >= 0 ? index as number : undefined
}

function shape(chunk: unknown): chunk is StreamChunk {
  return isObject(chunk) && typeof chunk.type === 'string'
}

function validUsage(value: unknown): boolean {
  if (!isObject(value)) return false
  for (const key of ['inputTokens', 'outputTokens', 'totalTokens', 'cacheReadTokens', 'cacheWriteTokens', 'reasoningTokens']) {
    if (value[key] !== undefined && (!Number.isSafeInteger(value[key]) || (value[key] as number) < 0)) return false
  }
  return Number.isSafeInteger(value.inputTokens) && Number.isSafeInteger(value.outputTokens)
}

function validReplay(value: unknown, blockCount: number): boolean {
  if (!isObject(value) || !Object.prototype.hasOwnProperty.call(value, 'response')) return false
  if (value.blocks !== undefined && (!Array.isArray(value.blocks) || value.blocks.length !== blockCount)) return false
  return true
}

function validFailure(value: unknown): boolean {
  if (!isObject(value) || typeof value.message !== 'string' || value.message.length === 0
    || typeof value.code !== 'string' || value.code.length === 0) return false
  if (value.status !== undefined && (!Number.isInteger(value.status) || (value.status as number) < 100 || (value.status as number) > 599)) return false
  if (value.providerRetryAfterMs !== undefined && (!Number.isFinite(value.providerRetryAfterMs) || (value.providerRetryAfterMs as number) <= 0)) return false
  if (value.requestId !== undefined && (typeof value.requestId !== 'string' || value.requestId.length === 0)) return false
  return true
}

/** Pure runtime validator for the normalized StreamChunk grammar. */
export class StreamValidator {
  private readonly blocks = new Map<number, BlockState>()
  private readonly order: number[] = []
  private readonly ids = new Set<string>()
  private usageSeen = false
  private finishSeen = false
  private finishChunk: StreamChunk | undefined
  private _sawTool = false
  private _chunkCount = 0
  private firstViolation: Violation | undefined

  constructor(private readonly config: SentinelConfig) {}

  get chunkCount(): number { return this._chunkCount }
  get blockCount(): number { return this.order.length }
  get sawTool(): boolean { return this._sawTool }
  get violation(): Violation | undefined { return this.firstViolation }

  private fail(item: Violation): ValidationResult {
    this.firstViolation ??= item
    return { violation: item, toolRelated: false, firstSeenBlock: false }
  }

  private ensureIndex(chunk: StreamChunk): number | Violation {
    const index = indexOf(chunk)
    return index === undefined ? violation('SIS_INDEX_INVALID') : index
  }

  private checkCommon(chunk: unknown): StreamChunk | Violation {
    if (!shape(chunk)) return violation('SIS_CHUNK_SHAPE')
    if (!CHUNK_TYPES.has(chunk.type as string)) return violation('SIS_UNKNOWN_CHUNK', undefined, undefined, String(chunk.type))
    return chunk
  }

  push(input: unknown): ValidationResult {
    this._chunkCount += 1
    if (this._chunkCount > this.config.maxChunksPerCall) return this.fail(violation('SIS_LIMIT_EXCEEDED', undefined, this._chunkCount, 'chunks'))
    const checked = this.checkCommon(input)
    if (!shape(checked)) return this.fail(checked)
    const chunk = checked
    if (this.finishSeen) {
      if (chunk.type === 'finish') return this.fail(violation('SIS_FINISH_DUPLICATE'))
      return this.fail(violation('SIS_AFTER_FINISH'))
    }

    switch (chunk.type) {
      case 'block-start': {
        const index = this.ensureIndex(chunk)
        if (typeof index !== 'number') return this.fail(index)
        if (typeof chunk.blockType !== 'string' || chunk.blockType.length === 0) return this.fail(violation('SIS_CHUNK_SHAPE', index))
        if (this.blocks.has(index)) return this.fail(violation('SIS_BLOCK_START_DUPLICATE', index))
        if (this.order.length >= this.config.maxBlocksPerCall) return this.fail(violation('SIS_LIMIT_EXCEEDED', index, this.order.length + 1, 'blocks'))
        this.blocks.set(index, {
          index,
          type: chunk.blockType,
          closed: false,
          ...(chunk.blockType === 'tool-call' ? { tool: createToolBlock(index) } : {}),
        })
        this.order.push(index)
        return { toolRelated: chunk.blockType === 'tool-call', firstSeenBlock: true }
      }
      case 'text-delta':
      case 'reasoning-delta': {
        const index = this.ensureIndex(chunk)
        if (typeof index !== 'number') return this.fail(index)
        if (typeof chunk.text !== 'string') return this.fail(violation('SIS_CHUNK_SHAPE', index))
        const expected = chunk.type === 'text-delta' ? 'text' : 'reasoning'
        let block = this.blocks.get(index)
        let firstSeenBlock = false
        if (!block) {
          if (this.order.length >= this.config.maxBlocksPerCall) return this.fail(violation('SIS_LIMIT_EXCEEDED', index, this.order.length + 1, 'blocks'))
          block = { index, type: expected, closed: false }
          this.blocks.set(index, block); this.order.push(index); firstSeenBlock = true
        }
        if (block.type !== expected) return this.fail(violation('SIS_BLOCK_TYPE_CONFLICT', index))
        if (block.closed) return this.fail(violation('SIS_STRAGGLER', index))
        return { toolRelated: false, firstSeenBlock }
      }
      case 'tool-call-delta': {
        const index = this.ensureIndex(chunk)
        if (typeof index !== 'number') return this.fail(index)
        let block = this.blocks.get(index)
        let firstSeenBlock = false
        if (!block) {
          if (this.order.length >= this.config.maxBlocksPerCall) return this.fail(violation('SIS_LIMIT_EXCEEDED', index, this.order.length + 1, 'blocks'))
          const tool = createToolBlock(index)
          block = { index, type: 'tool-call', closed: false, tool }
          this.blocks.set(index, block); this.order.push(index); firstSeenBlock = true
        }
        if (block.type !== 'tool-call') return this.fail(violation('SIS_BLOCK_TYPE_CONFLICT', index))
        if (block.closed || block.tool === undefined) return this.fail(violation('SIS_STRAGGLER', index))
        const id = chunk.id
        if (typeof id === 'string' && id.trim().length > 0 && block.tool.id === undefined && this.ids.has(id)) return this.fail(violation('SIS_TOOL_ID_DUPLICATE', index))
        const result = acceptToolDelta(block.tool, chunk, this.config.maxArgumentsBytesPerTool)
        if (result) return this.fail(result)
        if (block.tool.id !== undefined) this.ids.add(block.tool.id)
        this._sawTool = true
        return { toolRelated: true, firstSeenBlock }
      }
      case 'block-end': {
        const index = this.ensureIndex(chunk)
        if (typeof index !== 'number') return this.fail(index)
        if (!isObject(chunk.block) || typeof chunk.block.type !== 'string' || chunk.block.type.length === 0) return this.fail(violation('SIS_CHUNK_SHAPE', index))
        let block = this.blocks.get(index)
        let firstSeenBlock = false
        if (!block) {
          if (this.order.length >= this.config.maxBlocksPerCall) return this.fail(violation('SIS_LIMIT_EXCEEDED', index, this.order.length + 1, 'blocks'))
          if (chunk.block.type === 'tool-call') {
            const result = toolBlockFromEnd(index, chunk.block, this.config.maxArgumentsBytesPerTool)
            if ('rule' in result) return this.fail(result)
            if (this.ids.has(result.id!)) return this.fail(violation('SIS_TOOL_ID_DUPLICATE', index))
            block = { index, type: 'tool-call', closed: true, tool: result }
            this.ids.add(result.id!)
            this._sawTool = true
          } else {
            block = { index, type: chunk.block.type, closed: true }
          }
          this.blocks.set(index, block); this.order.push(index); firstSeenBlock = true
          return { toolRelated: chunk.block.type === 'tool-call', firstSeenBlock }
        }
        if (block.type !== chunk.block.type) return this.fail(violation('SIS_BLOCK_TYPE_CONFLICT', index))
        if (block.closed) return this.fail(violation('SIS_BLOCK_END_DUPLICATE', index))
        if (block.type === 'tool-call') {
          if (block.tool === undefined) return this.fail(violation('SIS_CHUNK_SHAPE', index))
          const result = closeToolBlock(block.tool, chunk.block)
          if (result) return this.fail(result)
          if (block.tool.id !== undefined && this.ids.has(block.tool.id)) {
            // The current index already owns this id; only another index is a duplicate.
            const owners = this.order.filter(other => other !== index && this.blocks.get(other)?.tool?.id === block.tool?.id)
            if (owners.length > 0) return this.fail(violation('SIS_TOOL_ID_DUPLICATE', index))
          }
          if (block.tool.id !== undefined) this.ids.add(block.tool.id)
          this._sawTool = true
        }
        block.closed = true
        return { toolRelated: block.type === 'tool-call', firstSeenBlock }
      }
      case 'usage':
        if (this.usageSeen) return this.fail(violation('SIS_USAGE_DUPLICATE'))
        if (!validUsage(chunk.usage)) return this.fail(violation('SIS_CHUNK_SHAPE'))
        this.usageSeen = true
        return { toolRelated: false, firstSeenBlock: false }
      case 'finish': {
        if (!isObject(chunk.reason) || typeof chunk.reason.kind !== 'string' || !FINISH_KINDS.has(chunk.reason.kind)) return this.fail(violation('SIS_CHUNK_SHAPE'))
        const kind = chunk.reason.kind
        if ((kind === 'error' || kind === 'aborted') && !validFailure(chunk.reason.failure)) return this.fail(violation('SIS_CHUNK_SHAPE'))
        if (chunk.replayState !== undefined
          && (kind === 'max-tokens' || kind === 'error' || kind === 'aborted')) return this.fail(violation('SIS_REPLAY_STATE_INVALID'))
        if (chunk.replayState !== undefined && !validReplay(chunk.replayState, this.order.length)) return this.fail(violation('SIS_REPLAY_STATE_INVALID'))
        if ((kind === 'stop' || kind === 'tool-calls') && [...this.blocks.values()].some(block => !block.closed)) return this.fail(violation('SIS_CHUNK_SHAPE'))
        if (this._sawTool && kind === 'stop') return this.fail(violation('SIS_FINISH_TOOL_MISMATCH'))
        if (kind === 'tool-calls') {
          const tools = [...this.blocks.values()].filter(block => block.type === 'tool-call')
          if (tools.length === 0 || tools.some(block => block.tool === undefined || validateCompleteTool(block.tool))) return this.fail(violation('SIS_FINISH_TOOL_MISMATCH'))
        }
        this.finishSeen = true
        this.finishChunk = chunk
        return { toolRelated: false, firstSeenBlock: false }
      }
    }
    return this.fail(violation('SIS_CHUNK_SHAPE'))
  }

  finish(): Violation | undefined {
    if (!this.finishSeen) return violation('SIS_FINISH_MISSING')
    return undefined
  }

  summary(): ValidationSummary {
    return {
      sawTool: this._sawTool,
      blockCount: this.order.length,
      ...(this.finishChunk === undefined ? {} : { finish: this.finishChunk }),
      ...isObject(this.finishChunk?.reason) && typeof this.finishChunk.reason.kind === 'string'
        ? { finishKind: this.finishChunk.reason.kind } : {},
      blockOrder: Object.freeze([...this.order]),
    }
  }
}
