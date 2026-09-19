import type { SentinelConfig } from './types.js';
/** Validate, default, and freeze one plugin configuration. */
export declare function normalizeConfig(input?: unknown): SentinelConfig;
/** Apply include-first, exclude-last exact route matching. */
export declare function routeIncluded(config: SentinelConfig, provider: unknown, model: unknown): boolean;
export declare function isToolCapable(options: unknown): boolean;
//# sourceMappingURL=config.d.ts.map