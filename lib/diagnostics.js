const CONTROL = /[\u0000-\u001f\u007f]/g;
function safeScalar(value) {
    if (typeof value === 'number' && Number.isSafeInteger(value))
        return String(value);
    if (typeof value !== 'string')
        return '';
    return value.replace(CONTROL, '').slice(0, 64);
}
export function violation(rule, index, count, detail) {
    return Object.freeze({
        rule,
        ...(index === undefined ? {} : { index }),
        ...(count === undefined ? {} : { count }),
        ...(detail === undefined ? {} : { detail: safeScalar(detail) }),
    });
}
/** Make a stable message containing only bounded routing/rule metadata. */
export function formatViolation(errorCode, item, provider, model) {
    const fields = [
        `code=${errorCode}`,
        `rule=${item.rule}`,
        ...typeof provider === 'string' ? [`provider=${safeScalar(provider)}`] : [],
        ...typeof model === 'string' ? [`model=${safeScalar(model)}`] : [],
        ...item.index === undefined ? [] : [`index=${item.index}`],
        ...item.count === undefined ? [] : [`count=${item.count}`],
    ];
    return `normalized model stream rejected (${fields.join(',')})`.slice(0, 256);
}
export function emitDiagnostic(sink, item) {
    try {
        sink?.(item);
    }
    catch { /* diagnostics never alter stream disposition */ }
}
//# sourceMappingURL=diagnostics.js.map