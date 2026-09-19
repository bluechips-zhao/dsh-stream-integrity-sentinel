import { emitDiagnostic, formatViolation, violation } from './diagnostics.js';
import { StreamValidator } from './validator.js';
const encoder = new TextEncoder();
function byteSize(value) {
    try {
        const encoded = JSON.stringify(value);
        return encoded === undefined ? 0 : encoder.encode(encoded).byteLength;
    }
    catch {
        return Number.POSITIVE_INFINITY;
    }
}
function errorFinish(code, item, context) {
    return {
        type: 'finish',
        reason: {
            kind: 'error',
            failure: {
                code,
                message: formatViolation(code, item, context.provider, context.model),
            },
        },
    };
}
function nonSuccessFinish(chunk) {
    const reason = chunk.reason;
    return {
        type: 'finish',
        reason: reason.kind === 'max-tokens'
            ? { kind: 'max-tokens' }
            : { kind: reason.kind, ...(reason.failure === undefined ? {} : { failure: reason.failure }) },
    };
}
async function cleanup(iterator) {
    try {
        await iterator?.return?.();
    }
    catch { /* cleanup failure cannot release quarantined data */ }
}
/**
 * Guard one normalized stream. Healthy chunks are yielded by original
 * reference. Once a tool-related chunk appears, every later chunk is held
 * until the upstream iterator returns done.
 */
export async function* guardStream(source, config, context = {}, diagnostics) {
    let iterator;
    const validator = new StreamValidator(config);
    const tail = [];
    let quarantined = false;
    let quarantinedBytes = 0;
    let done = false;
    let cleaned = false;
    let suppressTail = false;
    let terminal;
    let truncated = false;
    let observedFirstViolation;
    let observedViolationCount = 0;
    const observeViolation = (item) => {
        observedViolationCount += 1;
        if (observedFirstViolation === undefined) {
            observedFirstViolation = item;
            emitDiagnostic(diagnostics, item);
        }
    };
    const emitObserveSummary = () => {
        if (observedFirstViolation !== undefined && observedViolationCount > 1) {
            emitDiagnostic(diagnostics, violation(observedFirstViolation.rule, observedFirstViolation.index, observedViolationCount, 'observed-count'));
        }
    };
    const fail = async (item, internal = false) => {
        emitDiagnostic(diagnostics, item);
        cleaned = true;
        await cleanup(iterator);
        return errorFinish(internal ? 'STREAM_INTEGRITY_INTERNAL' : 'STREAM_INTEGRITY_VIOLATION', item, context);
    };
    try {
        try {
            iterator = source[Symbol.asyncIterator]();
        }
        catch {
            const output = errorFinish('STREAM_INTEGRITY_INTERNAL', violation('SIS_CHUNK_SHAPE'), context);
            if (config.mode === 'observe')
                return;
            yield output;
            return;
        }
        const activeIterator = iterator;
        while (true) {
            if (context.signal?.aborted) {
                cleaned = true;
                await cleanup(iterator);
                return;
            }
            let step;
            try {
                step = await activeIterator.next();
            }
            catch {
                const item = violation('SIS_CHUNK_SHAPE');
                const output = await fail(item, true);
                if (config.mode === 'observe')
                    return;
                yield output;
                return;
            }
            if (context.signal?.aborted) {
                cleaned = true;
                await cleanup(iterator);
                return;
            }
            if (step.done) {
                done = true;
                break;
            }
            const raw = step.value;
            const result = truncated
                ? { toolRelated: false, firstSeenBlock: false }
                : validator.push(raw);
            if ('violation' in result && result.violation !== undefined) {
                if (config.mode === 'observe') {
                    observeViolation(result.violation);
                    if (result.violation.rule === 'SIS_LIMIT_EXCEEDED')
                        truncated = true;
                    yield raw;
                    continue;
                }
                const output = await fail(result.violation);
                yield output;
                return;
            }
            const chunk = raw;
            if (config.mode === 'observe') {
                yield chunk;
                continue;
            }
            if (!quarantined && result.toolRelated)
                quarantined = true;
            if (quarantined) {
                const added = byteSize(chunk);
                quarantinedBytes += added;
                if (quarantinedBytes > config.maxQuarantineBytes) {
                    const limit = violation('SIS_LIMIT_EXCEEDED', undefined, quarantinedBytes, 'quarantine');
                    const output = await fail(limit);
                    yield output;
                    return;
                }
                tail.push(chunk);
                if (chunk.type === 'finish') {
                    terminal = chunk;
                    const reason = chunk.reason;
                    suppressTail = reason.kind === 'max-tokens' || reason.kind === 'error' || reason.kind === 'aborted';
                }
            }
            else {
                yield chunk;
            }
        }
        // Once observe reaches a bound, the validator is intentionally no longer
        // authoritative for the rest of the stream, including terminal shape.
        if (truncated) {
            emitObserveSummary();
            return;
        }
        const endViolation = validator.finish();
        if (endViolation !== undefined) {
            if (config.mode === 'observe') {
                observeViolation(endViolation);
            }
            else {
                const output = await fail(endViolation);
                yield output;
                return;
            }
        }
        if (config.mode === 'observe') {
            emitObserveSummary();
            return;
        }
        if (context.signal?.aborted)
            return;
        if (!quarantined)
            return;
        if (suppressTail && terminal !== undefined) {
            yield nonSuccessFinish(terminal);
            return;
        }
        for (const chunk of tail) {
            if (context.signal?.aborted)
                return;
            yield chunk;
        }
    }
    catch {
        if (config.mode === 'observe')
            return;
        const output = await fail(violation('SIS_CHUNK_SHAPE'), true);
        yield output;
    }
    finally {
        if (!done && !cleaned)
            await cleanup(iterator);
        tail.length = 0;
    }
}
//# sourceMappingURL=guard-stream.js.map