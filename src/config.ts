import type { SentinelConfig, SentinelConfigInput } from './types.js'

const DEFAULTS = {
  scope: 'tool-capable-calls',
  maxQuarantineBytes: 4 * 1024 * 1024,
  maxChunksPerCall: 50_000,
  maxBlocksPerCall: 256,
  maxArgumentsBytesPerTool: 1024 * 1024,
  diagnostics: 'errors',
} as const

const BOUNDS = {
  maxQuarantineBytes: [64 * 1024, 64 * 1024 * 1024],
  maxChunksPerCall: [100, 1_000_000],
  maxBlocksPerCall: [1, 4096],
  maxArgumentsBytesPerTool: [1024, 16 * 1024 * 1024],
} as const

const KEYS = new Set([
  'mode', 'scope', 'includeProviders', 'excludeProviders', 'includeModels', 'excludeModels',
  'maxQuarantineBytes', 'maxChunksPerCall', 'maxBlocksPerCall', 'maxArgumentsBytesPerTool',
  'diagnostics',
])

function fail(message: string): never {
  throw new TypeError(`invalid stream-integrity-sentinel config: ${message}`)
}

function strings(value: unknown, key: string): readonly string[] {
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) fail(`${key} must be a string array`)
  return Object.freeze([...value])
}

function boundedInteger(value: unknown, key: keyof typeof BOUNDS): number {
  const bounds = BOUNDS[key]
  const numeric = typeof value === 'number' ? value : Number.NaN
  if (!Number.isSafeInteger(numeric) || numeric < bounds[0] || numeric > bounds[1]) {
    fail(`${key} must be a safe integer in [${bounds[0]}, ${bounds[1]}]`)
  }
  return numeric
}

/** Validate, default, and freeze one plugin configuration. */
export function normalizeConfig(input: unknown = {}): SentinelConfig {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) fail('config must be an object')
  const value = input as Record<string, unknown>
  for (const key of Object.keys(value)) if (!KEYS.has(key)) fail(`unknown field ${key}`)

  const mode = value.mode ?? 'enforce'
  if (mode !== 'enforce' && mode !== 'observe') fail('mode must be enforce or observe')
  const scope = value.scope ?? DEFAULTS.scope
  if (scope !== DEFAULTS.scope) fail('scope must be tool-capable-calls')
  const diagnostics = value.diagnostics ?? DEFAULTS.diagnostics
  if (diagnostics !== 'errors' && diagnostics !== 'all' && diagnostics !== 'off') fail('diagnostics is invalid')

  const result: SentinelConfig = {
    mode,
    scope,
    includeProviders: strings(value.includeProviders ?? [], 'includeProviders'),
    excludeProviders: strings(value.excludeProviders ?? [], 'excludeProviders'),
    includeModels: strings(value.includeModels ?? [], 'includeModels'),
    excludeModels: strings(value.excludeModels ?? [], 'excludeModels'),
    maxQuarantineBytes: value.maxQuarantineBytes === undefined
      ? DEFAULTS.maxQuarantineBytes : boundedInteger(value.maxQuarantineBytes, 'maxQuarantineBytes'),
    maxChunksPerCall: value.maxChunksPerCall === undefined
      ? DEFAULTS.maxChunksPerCall : boundedInteger(value.maxChunksPerCall, 'maxChunksPerCall'),
    maxBlocksPerCall: value.maxBlocksPerCall === undefined
      ? DEFAULTS.maxBlocksPerCall : boundedInteger(value.maxBlocksPerCall, 'maxBlocksPerCall'),
    maxArgumentsBytesPerTool: value.maxArgumentsBytesPerTool === undefined
      ? DEFAULTS.maxArgumentsBytesPerTool : boundedInteger(value.maxArgumentsBytesPerTool, 'maxArgumentsBytesPerTool'),
    diagnostics,
  }
  return Object.freeze(result)
}

/** Apply include-first, exclude-last exact route matching. */
export function routeIncluded(config: SentinelConfig, provider: unknown, model: unknown): boolean {
  if (typeof provider !== 'string' || typeof model !== 'string') return false
  const includedProvider = config.includeProviders.length === 0 || config.includeProviders.includes(provider)
  const includedModel = config.includeModels.length === 0 || config.includeModels.includes(model)
  if (!includedProvider || !includedModel) return false
  return !config.excludeProviders.includes(provider) && !config.excludeModels.includes(model)
}

export function isToolCapable(options: unknown): boolean {
  if (typeof options !== 'object' || options === null) return false
  const tools = (options as { tools?: unknown }).tools
  return Array.isArray(tools) && tools.length > 0
}
