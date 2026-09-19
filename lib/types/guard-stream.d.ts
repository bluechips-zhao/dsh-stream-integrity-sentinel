import type { DiagnosticSink, GuardContext, SentinelConfig, StreamChunk } from './types.js';
/**
 * Guard one normalized stream. Healthy chunks are yielded by original
 * reference. Once a tool-related chunk appears, every later chunk is held
 * until the upstream iterator returns done.
 */
export declare function guardStream(source: AsyncIterable<unknown>, config: SentinelConfig, context?: GuardContext, diagnostics?: DiagnosticSink): AsyncGenerator<StreamChunk>;
//# sourceMappingURL=guard-stream.d.ts.map