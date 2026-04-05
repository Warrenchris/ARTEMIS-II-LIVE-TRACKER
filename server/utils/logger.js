/**
 * Structured JSON Logger
 * ----------------------
 * Writes newline-delimited JSON to stdout (INFO/DEBUG) or stderr (WARN/ERROR).
 * Replaces all console.log usage for production-safe, parseable log output.
 *
 * Output shape:
 *   { "ts": "2026-04-06T00:00:00.000Z", "level": "INFO", "svc": "artemis", "msg": "...", ...meta }
 */

const SERVICE = 'artemis-telemetry';

/**
 * @param {'INFO'|'WARN'|'ERROR'|'DEBUG'} level
 * @param {string} msg
 * @param {Record<string, unknown>} [meta]
 */
function write(level, msg, meta = {}) {
  const entry = JSON.stringify({
    ts:    new Date().toISOString(),
    level,
    svc:   SERVICE,
    msg,
    ...meta,
  });

  // Errors and warnings go to stderr so process managers / log routers can triage
  if (level === 'ERROR' || level === 'WARN') {
    process.stderr.write(entry + '\n');
  } else {
    process.stdout.write(entry + '\n');
  }
}

const logger = {
  info:  (msg, meta) => write('INFO',  msg, meta),
  debug: (msg, meta) => write('DEBUG', msg, meta),
  warn:  (msg, meta) => write('WARN',  msg, meta),
  error: (msg, meta) => write('ERROR', msg, meta),
};

module.exports = logger;
