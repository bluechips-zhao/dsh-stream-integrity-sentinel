import type { SentinelConfig, StreamChunk, Violation } from './types.js';
export interface ValidationResult {
    readonly violation?: Violation;
    readonly toolRelated: boolean;
    readonly firstSeenBlock: boolean;
}
export interface ValidationSummary {
    readonly sawTool: boolean;
    readonly blockCount: number;
    readonly finish?: StreamChunk;
    readonly finishKind?: string;
    readonly blockOrder: readonly number[];
}
/** Pure runtime validator for the normalized StreamChunk grammar. */
export declare class StreamValidator {
    private readonly config;
    private readonly blocks;
    private readonly order;
    private readonly ids;
    private usageSeen;
    private finishSeen;
    private finishChunk;
    private _sawTool;
    private _chunkCount;
    private firstViolation;
    constructor(config: SentinelConfig);
    get chunkCount(): number;
    get blockCount(): number;
    get sawTool(): boolean;
    get violation(): Violation | undefined;
    private fail;
    private ensureIndex;
    private checkCommon;
    push(input: unknown): ValidationResult;
    finish(): Violation | undefined;
    summary(): ValidationSummary;
}
//# sourceMappingURL=validator.d.ts.map