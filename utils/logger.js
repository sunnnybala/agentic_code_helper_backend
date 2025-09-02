// Lightweight console-based logger replacement.
// This keeps the same exported interface as before but uses simple console methods
// to make debugging and local tracing straightforward.

const LEVELS = { ERROR: 0, WARN: 1, INFO: 2, DEBUG: 3 };
const CURRENT_LEVEL = process.env.LOG_LEVEL && LEVELS[process.env.LOG_LEVEL.toUpperCase()] !== undefined
  ? LEVELS[process.env.LOG_LEVEL.toUpperCase()]
  : LEVELS.INFO;

function shouldLog(level) {
  return LEVELS[level] <= CURRENT_LEVEL;
}

export const logger = {
  error: (msg, ctx = {}) => {
    if (!shouldLog('ERROR')) return;
    console.error('[ERROR]', msg, ctx);
  },

  warn: (msg, ctx = {}) => {
    if (!shouldLog('WARN')) return;
    console.warn('[WARN]', msg, ctx);
  },

  info: (msg, ctx = {}) => {
    if (!shouldLog('INFO')) return;
    console.log('[INFO]', msg, ctx);
  },

  debug: (msg, ctx = {}) => {
    if (!shouldLog('DEBUG')) return;
    console.debug('[DEBUG]', msg, ctx);
  },

  // Request logging middleware (simple)
  requestLogger: (req, res, next) => {
    const start = Date.now();
    const requestId = Math.random().toString(36).slice(2, 10);
    req.requestId = requestId;

    console.log('[REQUEST START]', { requestId, method: req.method, url: req.url, ip: req.ip });

    const originalSend = res.send;
    res.send = function (data) {
      const duration = Date.now() - start;
      try {
        console.log('[REQUEST END]', { requestId, method: req.method, url: req.url, statusCode: res.statusCode, duration: `${duration}ms`, responseSize: Buffer.isBuffer(data) ? data.length : (typeof data === 'string' ? data.length : 'unknown') });
      } catch (e) {
        console.log('[REQUEST END]', { requestId, method: req.method, url: req.url, statusCode: res.statusCode, duration: `${duration}ms` });
      }
      return originalSend.call(this, data);
    };

    next();
  },

  // Error logging middleware
  errorLogger: (err, req, res, next) => {
    const requestId = req.requestId || 'unknown';
    console.error('[UNHANDLED ERROR]', { requestId, message: err?.message, stack: err?.stack, method: req?.method, url: req?.url });
    next(err);
  }
};

export function createLogger(context = {}) {
  return {
    error: (msg, ctx = {}) => logger.error(msg, { ...context, ...ctx }),
    warn: (msg, ctx = {}) => logger.warn(msg, { ...context, ...ctx }),
    info: (msg, ctx = {}) => logger.info(msg, { ...context, ...ctx }),
    debug: (msg, ctx = {}) => logger.debug(msg, { ...context, ...ctx })
  };
}

export default logger;

