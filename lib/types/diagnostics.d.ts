import type { DiagnosticSink, RuleId, Violation } from './types.js';
export declare function violation(rule: RuleId, index?: number, count?: number, detail?: string): Violation;
/** Make a stable message containing only bounded routing/rule metadata. */
export declare function formatViolation(errorCode: 'STREAM_INTEGRITY_VIOLATION' | 'STREAM_INTEGRITY_INTERNAL', item: Readonly<Violation>, provider?: unknown, model?: unknown): string;
export declare function emitDiagnostic(sink: DiagnosticSink | undefined, item: Readonly<Violation>): void;
//# sourceMappingURL=diagnostics.d.ts.map