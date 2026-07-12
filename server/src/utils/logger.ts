import pino from 'pino';

export const baseLogger = pino({
  level: process.env.LOG_LEVEL ?? (process.env.NODE_ENV === 'production' ? 'info' : 'debug'),
});

const base = baseLogger;

// Thin wrapper that keeps the call-site API `logger.info(msg, meta?)` while
// delegating to pino's structured `base.info(obj, msg)` under the hood.
const wrap = (fn: (obj: object, msg: string) => void, fnStr: (msg: string) => void) =>
  (msg: string, meta?: unknown) =>
    meta !== undefined ? fn(meta as object, msg) : fnStr(msg);

export const logger = {
  info:  wrap(base.info.bind(base),  base.info.bind(base)),
  warn:  wrap(base.warn.bind(base),  base.warn.bind(base)),
  error: wrap(base.error.bind(base), base.error.bind(base)),
  debug: wrap(base.debug.bind(base), base.debug.bind(base)),
};
