/** Cordis-free structural types used by the stream firewall. */

export type SentinelMode = 'enforce' | 'observe'
export type DiagnosticsMode = 'errors' | 'all' | 'off'

export interface SentinelConfigInput {
  mode?: SentinelMode
  scope?: 'tool-capable-calls'
  includeProviders?: string[]
  excludeProviders?: string[]
  includeModels?: string[]
  excludeModels?: string[]
  maxQuarantineBytes?: number
  maxChunksPerCall?: number
  maxBlocksPerCall?: number
  maxArgumentsBytesPerTool?: number
  diagnostics?: DiagnosticsMode
}

export interface SentinelConfig {
  readonly mode: SentinelMode
  readonly scope: 'tool-capable-calls'
  readonly includeProviders: readonly string[]
  readonly excludeProviders: readonly string[]
  readonly includeModels: readonly string[]
  readonly excludeModels: readonly string[]
  readonly maxQuarantineBytes: number
  readonly maxChunksPerCall: number
  readonly maxBlocksPerCall: number
  readonly maxArgumentsBytesPerTool: number
  readonly diagnostics: DiagnosticsMode
}

export type RuleId =
  | 'SIS_CHUNK_SHAPE'
  | 'SIS_INDEX_INVALID'
  | 'SIS_BLOCK_TYPE_CONFLICT'
  | 'SIS_BLOCK_START_DUPLICATE'
  | 'SIS_BLOCK_END_DUPLICATE'
  | 'SIS_BLOCK_END_MISMATCH'
  | 'SIS_STRAGGLER'
  | 'SIS_TOOL_ID_EMPTY'
  | 'SIS_TOOL_ID_CHANGED'
  | 'SIS_TOOL_ID_DUPLICATE'
  | 'SIS_TOOL_NAME_MISSING'
  | 'SIS_TOOL_NAME_CHANGED'
  | 'SIS_ARGUMENTS_INVALID_JSON'
  | 'SIS_USAGE_DUPLICATE'
  | 'SIS_FINISH_DUPLICATE'
  | 'SIS_AFTER_FINISH'
  | 'SIS_FINISH_MISSING'
  | 'SIS_FINISH_TOOL_MISMATCH'
  | 'SIS_REPLAY_STATE_INVALID'
  | 'SIS_LIMIT_EXCEEDED'
  | 'SIS_UNKNOWN_CHUNK'

export interface Violation {
  readonly rule: RuleId
  readonly index?: number
  readonly count?: number
  readonly detail?: string
}

export interface DiagnosticSink {
  (diagnostic: Readonly<Violation>): void
}

export interface GuardContext {
  readonly provider?: unknown
  readonly model?: unknown
  readonly signal?: AbortSignal
}

export type StreamChunk = Record<string, unknown>
