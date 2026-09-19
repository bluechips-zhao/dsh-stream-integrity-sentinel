import z from '@deepseek-ai/schemastery';
import { normalizeConfig, isToolCapable, routeIncluded } from './config.js';
import { emitDiagnostic, formatViolation } from './diagnostics.js';
import { guardStream } from './guard-stream.js';
/** Loader-facing schema; normalizeConfig performs the strict unknown-key check. */
export const Config = z.object({
    mode: z.union(['enforce', 'observe']).default('enforce'),
    scope: z.union(['tool-capable-calls']).default('tool-capable-calls'),
    includeProviders: z.array(z.string()).default([]),
    excludeProviders: z.array(z.string()).default([]),
    includeModels: z.array(z.string()).default([]),
    excludeModels: z.array(z.string()).default([]),
    maxQuarantineBytes: z.natural().min(64 * 1024).max(64 * 1024 * 1024).default(4 * 1024 * 1024),
    maxChunksPerCall: z.natural().min(100).max(1_000_000).default(50_000),
    maxBlocksPerCall: z.natural().min(1).max(4096).default(256),
    maxArgumentsBytesPerTool: z.natural().min(1024).max(16 * 1024 * 1024).default(1024 * 1024),
    diagnostics: z.union(['errors', 'all', 'off']).default('errors'),
});
export const name = 'stream-integrity-sentinel';
export const inject = ['llm'];
function diagnosticSink(ctx, config) {
    if (config.diagnostics === 'off')
        return undefined;
    const logger = ctx.logger(name);
    return (item) => {
        const message = formatViolation('STREAM_INTEGRITY_VIOLATION', item);
        logger.warn(message);
    };
}
function warnAlwaysRetry(ctx) {
    const warned = new Set();
    const check = () => {
        for (const provider of ctx.llm.listProviders()) {
            let mode;
            try {
                mode = ctx.llm.providerRetryPolicy(provider.id).mode;
            }
            catch {
                continue;
            }
            if (mode === 'always') {
                if (warned.has(provider.id))
                    continue;
                warned.add(provider.id);
                ctx.logger(name).warn(`provider=${provider.id} retryPolicy=always; integrity failures may be retried indefinitely`);
            }
            else {
                warned.delete(provider.id);
            }
        }
    };
    check();
    return ctx.on('llm/adapters-updated', check, { global: true });
}
/** Mount the fail-closed normalized stream firewall on the public LLM waterfall. */
export function apply(ctx, rawConfig) {
    const config = normalizeConfig(rawConfig);
    const sink = diagnosticSink(ctx, config);
    if (config.mode === 'observe')
        ctx.logger(name).warn('stream-integrity-sentinel mode=observe protection=disabled');
    const disposeAlwaysRetryWarning = warnAlwaysRetry(ctx);
    const disposeStream = ctx.on('llm/stream', function (options, next) {
        if (!isToolCapable(options) || !routeIncluded(config, options.provider, options.model))
            return next();
        return guardStream(next(), config, {
            provider: options.provider,
            model: options.model,
            ...(options.signal === undefined ? {} : { signal: options.signal }),
        }, sink);
    }, { global: true, prepend: true });
    return () => {
        disposeAlwaysRetryWarning();
        disposeStream();
        return true;
    };
}
//# sourceMappingURL=plugin.js.map