import type { Context } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
/** Loader-facing schema; normalizeConfig performs the strict unknown-key check. */
export declare const Config: z<Schemastery.ObjectS<{
    mode: z<"enforce" | "observe", "enforce" | "observe">;
    scope: z<"tool-capable-calls", "tool-capable-calls">;
    includeProviders: z<string[], string[]>;
    excludeProviders: z<string[], string[]>;
    includeModels: z<string[], string[]>;
    excludeModels: z<string[], string[]>;
    maxQuarantineBytes: z<number, number>;
    maxChunksPerCall: z<number, number>;
    maxBlocksPerCall: z<number, number>;
    maxArgumentsBytesPerTool: z<number, number>;
    diagnostics: z<"all" | "off" | "errors", "all" | "off" | "errors">;
}>, Schemastery.ObjectT<{
    mode: z<"enforce" | "observe", "enforce" | "observe">;
    scope: z<"tool-capable-calls", "tool-capable-calls">;
    includeProviders: z<string[], string[]>;
    excludeProviders: z<string[], string[]>;
    includeModels: z<string[], string[]>;
    excludeModels: z<string[], string[]>;
    maxQuarantineBytes: z<number, number>;
    maxChunksPerCall: z<number, number>;
    maxBlocksPerCall: z<number, number>;
    maxArgumentsBytesPerTool: z<number, number>;
    diagnostics: z<"all" | "off" | "errors", "all" | "off" | "errors">;
}>>;
export declare const name = "stream-integrity-sentinel";
export declare const inject: string[];
/** Mount the fail-closed normalized stream firewall on the public LLM waterfall. */
export declare function apply(ctx: Context, rawConfig: unknown): () => boolean;
//# sourceMappingURL=plugin.d.ts.map