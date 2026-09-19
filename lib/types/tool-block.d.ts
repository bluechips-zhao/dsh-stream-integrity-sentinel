import type { StreamChunk, Violation } from './types.js';
export interface ToolBlockState {
    readonly index: number;
    readonly type: 'tool-call';
    id?: string;
    name?: string;
    arguments: string;
    argumentsBytes: number;
    closed: boolean;
}
export declare const utf8Bytes: (value: string) => number;
export declare function createToolBlock(index: number): ToolBlockState;
export declare function acceptToolDelta(state: ToolBlockState, chunk: StreamChunk, maxArgumentsBytes: number): Violation | undefined;
export declare function closeToolBlock(state: ToolBlockState, block: Record<string, unknown>): Violation | undefined;
export declare function validateCompleteTool(state: ToolBlockState): Violation | undefined;
export declare function toolBlockFromEnd(index: number, block: Record<string, unknown>, maxArgumentsBytes: number): ToolBlockState | Violation;
//# sourceMappingURL=tool-block.d.ts.map