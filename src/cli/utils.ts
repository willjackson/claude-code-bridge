/**
 * CLI output formatting utilities
 *
 * Provides helpers for colored output, table formatting, progress spinners,
 * and option parsing/validation.
 */

/**
 * ANSI color codes for terminal output
 */
export const colors = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',

  // Foreground colors
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  gray: '\x1b[90m',
} as const;

/**
 * Check if terminal supports colors
 */
export function supportsColor(): boolean {
  // Disable colors if NO_COLOR env var is set
  if (process.env.NO_COLOR !== undefined) {
    return false;
  }

  // Enable colors if FORCE_COLOR is set
  if (process.env.FORCE_COLOR !== undefined) {
    return true;
  }

  // Check if stdout is a TTY
  if (typeof process.stdout.isTTY !== 'undefined' && process.stdout.isTTY) {
    return true;
  }

  return false;
}

/**
 * Apply color to text (only if terminal supports it)
 */
export function colorize(text: string, color: keyof typeof colors): string {
  if (!supportsColor()) {
    return text;
  }
  return `${colors[color]}${text}${colors.reset}`;
}

/**
 * Print success message (green)
 */
export function success(message: string): void {
  console.log(colorize('✓ ' + message, 'green'));
}

/**
 * Print error message (red)
 */
export function error(message: string): void {
  console.error(colorize('✗ ' + message, 'red'));
}

/**
 * Print warning message (yellow)
 */
export function warning(message: string): void {
  console.log(colorize('⚠ ' + message, 'yellow'));
}

/**
 * Print info message (blue)
 */
export function info(message: string): void {
  console.log(colorize('ℹ ' + message, 'blue'));
}

/**
 * Print debug message (gray)
 */
export function debug(message: string): void {
  console.log(colorize('⋯ ' + message, 'gray'));
}

/**
 * Table column configuration
 */
export interface TableColumn {
  title: string;
  width: number;
  align?: 'left' | 'right' | 'center';
}

/**
 * Table row data (key-value pairs matching column titles)
 */
export type TableRow = Record<string, string | number | undefined>;

/**
 * Pad a string to a specific width with alignment
 */
export function padToWidth(
  text: string,
  width: number,
  align: 'left' | 'right' | 'center' = 'left'
): string {
  const str = String(text).slice(0, width);
  const padding = width - str.length;

  if (align === 'right') {
    return ' '.repeat(padding) + str;
  } else if (align === 'center') {
    const leftPad = Math.floor(padding / 2);
    const rightPad = padding - leftPad;
    return ' '.repeat(leftPad) + str + ' '.repeat(rightPad);
  } else {
    return str + ' '.repeat(padding);
  }
}

/**
 * Print a formatted table
 */
export function printTable(
  columns: TableColumn[],
  rows: TableRow[],
  options: { indent?: number; borderStyle?: 'simple' | 'none' } = {}
): void {
  const indent = ' '.repeat(options.indent ?? 0);
  const borderStyle = options.borderStyle ?? 'simple';

  // Print header
  const headerRow = columns
    .map((col) => padToWidth(col.title, col.width, col.align))
    .join(' ');
  console.log(indent + colorize(headerRow, 'bold'));

  // Print separator
  if (borderStyle === 'simple') {
    const separator = columns
      .map((col) => '-'.repeat(col.width))
      .join(' ');
    console.log(indent + separator);
  }

  // Print rows
  for (const row of rows) {
    const rowText = columns
      .map((col) => {
        // Find matching key case-insensitively
        const key = Object.keys(row).find(
          (k) => k.toLowerCase() === col.title.toLowerCase()
        );
        const value = key ? String(row[key] ?? '') : '';
        return padToWidth(value, col.width, col.align);
      })
      .join(' ');
    console.log(indent + rowText);
  }
}

/**
 * Spinner frames for progress indication
 */
const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

/**
 * Progress spinner for long operations
 */
export class Spinner {
  private message: string;
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private frameIndex = 0;
  private stream = process.stdout;

  constructor(message: string) {
    this.message = message;
  }

  /**
   * Start the spinner animation
   */
  start(): void {
    if (!supportsColor() || !this.stream.isTTY) {
      // Non-TTY: just print the message once
      console.log(`... ${this.message}`);
      return;
    }

    // Hide cursor
    this.stream.write('\x1b[?25l');

    this.intervalId = setInterval(() => {
      const frame = SPINNER_FRAMES[this.frameIndex];
      this.stream.write(
        `\r${colorize(frame, 'cyan')} ${this.message}`
      );
      this.frameIndex = (this.frameIndex + 1) % SPINNER_FRAMES.length;
    }, 80);
  }

  /**
   * Update the spinner message
   */
  update(message: string): void {
    this.message = message;
  }

  /**
   * Stop the spinner with a success message
   */
  succeed(message?: string): void {
    this.stop();
    success(message ?? this.message);
  }

  /**
   * Stop the spinner with an error message
   */
  fail(message?: string): void {
    this.stop();
    error(message ?? this.message);
  }

  /**
   * Stop the spinner with a warning message
   */
  warn(message?: string): void {
    this.stop();
    warning(message ?? this.message);
  }

  /**
   * Stop the spinner (no message)
   */
  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }

    if (supportsColor() && this.stream.isTTY) {
      // Clear line and show cursor
      this.stream.write('\r\x1b[K');
      this.stream.write('\x1b[?25h');
    }
  }
}

/**
 * Create and start a new spinner
 */
export function spinner(message: string): Spinner {
  const s = new Spinner(message);
  s.start();
  return s;
}

/**
 * Parsed start command options
 */
export interface ParsedStartOptions {
  listen?: {
    port: number;
    host: string;
  };
  connect?: {
    url: string;
  };
  daemon: boolean;
}

/**
 * Parse and validate start command options
 */
export function parseStartOptions(options: {
  port?: string;
  host?: string;
  connect?: string;
  daemon?: boolean;
}): ParsedStartOptions {
  const result: ParsedStartOptions = {
    daemon: options.daemon ?? false,
  };

  // Parse port
  if (options.port) {
    const port = parseInt(options.port, 10);
    if (isNaN(port) || port < 1 || port > 65535) {
      throw new Error(`Invalid port: ${options.port}. Must be between 1 and 65535.`);
    }
    result.listen = {
      port,
      host: options.host ?? '0.0.0.0',
    };
  } else if (options.host) {
    // Host specified without port, use default port
    result.listen = {
      port: 8765,
      host: options.host,
    };
  }

  // Parse connect URL
  if (options.connect) {
    validateWebSocketUrl(options.connect);
    result.connect = {
      url: options.connect,
    };
  }

  return result;
}

/**
 * Validate a WebSocket URL
 */
export function validateWebSocketUrl(url: string): void {
  if (!url.startsWith('ws://') && !url.startsWith('wss://')) {
    throw new Error(
      `Invalid URL protocol. Expected ws:// or wss://, got: ${url}`
    );
  }

  try {
    const parsed = new URL(url);
    if (!parsed.hostname) {
      throw new Error('URL must include a hostname');
    }
  } catch (e) {
    if (e instanceof Error && e.message.includes('Invalid URL')) {
      throw new Error(`Invalid URL format: ${url}`);
    }
    throw e;
  }
}

/**
 * Parsed connect command options
 */
export interface ParsedConnectOptions {
  url: string;
}

/**
 * Parse and validate connect command options
 */
export function parseConnectOptions(options: {
  url?: string;
}): ParsedConnectOptions {
  if (!options.url) {
    throw new Error('URL is required');
  }

  validateWebSocketUrl(options.url);

  return {
    url: options.url,
  };
}

/**
 * Format duration in human-readable form
 */
export function formatDuration(ms: number): string {
  if (ms < 1000) {
    return `${ms}ms`;
  }
  if (ms < 60000) {
    return `${(ms / 1000).toFixed(1)}s`;
  }
  if (ms < 3600000) {
    const minutes = Math.floor(ms / 60000);
    const seconds = Math.round((ms % 60000) / 1000);
    return `${minutes}m ${seconds}s`;
  }
  const hours = Math.floor(ms / 3600000);
  const minutes = Math.round((ms % 3600000) / 60000);
  return `${hours}h ${minutes}m`;
}

/**
 * Format bytes in human-readable form
 */
export function formatBytes(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let unitIndex = 0;
  let value = bytes;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex++;
  }

  return `${value.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

/**
 * Shutdown handler type
 */
export type ShutdownHandler = (signal: string) => Promise<void>;

/**
 * Options for setting up graceful shutdown
 */
export interface GracefulShutdownOptions {
  /**
   * Cleanup function to call on shutdown
   */
  cleanup: () => Promise<void>;

  /**
   * Additional cleanup to call after main cleanup (e.g., removing PID file)
   */
  afterCleanup?: () => void;

  /**
   * Whether to show shutdown messages
   * @default true
   */
  verbose?: boolean;

  /**
   * Timeout in milliseconds before forcing exit
   * @default 10000
   */
  timeout?: number;
}

/**
 * Set up graceful shutdown handlers for SIGTERM and SIGINT
 *
 * Handles process signals to ensure clean shutdown of bridges and connections.
 * - SIGTERM: Sent by `kill` command or process managers
 * - SIGINT: Sent by Ctrl+C in terminal
 *
 * @param options Shutdown configuration options
 * @returns Function to remove the handlers (for testing)
 */
export function setupGracefulShutdown(options: GracefulShutdownOptions): () => void {
  const {
    cleanup,
    afterCleanup,
    verbose = true,
    timeout = 10000,
  } = options;

  let isShuttingDown = false;

  const handler: ShutdownHandler = async (signal: string) => {
    // Prevent multiple shutdown attempts
    if (isShuttingDown) {
      if (verbose) {
        console.log('Shutdown already in progress...');
      }
      return;
    }
    isShuttingDown = true;

    if (verbose) {
      console.log(`\nReceived ${signal}, shutting down gracefully...`);
    }

    // Set up force exit timeout
    const forceExitTimeout = setTimeout(() => {
      if (verbose) {
        console.error('Shutdown timeout - forcing exit');
      }
      process.exit(1);
    }, timeout);

    try {
      await cleanup();

      if (afterCleanup) {
        afterCleanup();
      }

      clearTimeout(forceExitTimeout);

      if (verbose) {
        console.log('Shutdown complete.');
      }
      process.exit(0);
    } catch (error) {
      clearTimeout(forceExitTimeout);
      if (verbose) {
        console.error(`Error during shutdown: ${(error as Error).message}`);
      }
      process.exit(1);
    }
  };

  // Register handlers
  const sigintHandler = () => handler('SIGINT');
  const sigtermHandler = () => handler('SIGTERM');

  process.on('SIGINT', sigintHandler);
  process.on('SIGTERM', sigtermHandler);

  // Return cleanup function
  return () => {
    process.off('SIGINT', sigintHandler);
    process.off('SIGTERM', sigtermHandler);
  };
}

/**
 * Handle unhandled promise rejections
 *
 * Logs unhandled rejections and optionally exits the process.
 *
 * @param options Configuration options
 */
export function handleUnhandledRejections(options: {
  exit?: boolean;
  logger?: (message: string, error: Error) => void;
} = {}): void {
  const { exit = false, logger = console.error } = options;

  process.on('unhandledRejection', (reason, promise) => {
    const error = reason instanceof Error ? reason : new Error(String(reason));
    logger('Unhandled promise rejection:', error);

    if (exit) {
      process.exit(1);
    }
  });
}
