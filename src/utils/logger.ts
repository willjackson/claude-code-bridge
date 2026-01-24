import pino from 'pino';

/**
 * Log levels supported by the logger
 */
export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';

/**
 * Logger interface (subset of pino.Logger for public API)
 */
export type Logger = pino.Logger;

/**
 * Determines if pretty printing should be used.
 * Only enabled when NODE_ENV is explicitly set to 'development'
 * to avoid errors when pino-pretty (a dev dependency) isn't installed.
 */
function usePrettyPrint(): boolean {
  return process.env.NODE_ENV === 'development';
}

/**
 * Gets the default log level from environment or falls back to 'info'
 */
function getDefaultLevel(): LogLevel {
  const envLevel = process.env.LOG_LEVEL?.toLowerCase() as LogLevel | undefined;
  const validLevels: LogLevel[] = ['trace', 'debug', 'info', 'warn', 'error', 'fatal'];
  if (envLevel && validLevels.includes(envLevel)) {
    return envLevel;
  }
  return 'info';
}

/**
 * Creates a logger instance with the given component name
 *
 * @param name - Component name to include in log output
 * @param level - Optional log level override (defaults to LOG_LEVEL env var or 'info')
 * @returns A pino logger instance configured for the component
 *
 * @example
 * ```typescript
 * const logger = createLogger('bridge');
 * logger.info('Bridge started');
 * logger.error({ err }, 'Connection failed');
 * ```
 */
export function createLogger(name: string, level?: LogLevel): Logger {
  const logLevel = level ?? getDefaultLevel();

  const options: pino.LoggerOptions = {
    name,
    level: logLevel,
  };

  // Use pretty printing only when explicitly in development mode
  if (usePrettyPrint()) {
    options.transport = {
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'SYS:standard',
        ignore: 'pid,hostname',
      },
    };
  }

  return pino(options);
}

/**
 * Creates a child logger from an existing logger with additional context
 *
 * @param parent - Parent logger instance
 * @param bindings - Additional context to include in all log messages
 * @returns A child logger instance
 */
export function createChildLogger(parent: Logger, bindings: Record<string, unknown>): Logger {
  return parent.child(bindings);
}
