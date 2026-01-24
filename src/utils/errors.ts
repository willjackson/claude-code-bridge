/**
 * Custom error classes for Claude Code Bridge
 *
 * Provides structured error types with clear, actionable messages
 * for different error scenarios.
 */

/**
 * Base error class for bridge errors
 */
export class BridgeError extends Error {
  readonly code: string;
  readonly context?: Record<string, unknown>;

  constructor(message: string, code: string, context?: Record<string, unknown>) {
    super(message);
    this.name = 'BridgeError';
    this.code = code;
    this.context = context;

    // Maintains proper stack trace for where error was thrown
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }

  /**
   * Get formatted error message with context
   */
  toDetailedString(): string {
    const parts = [`${this.name}[${this.code}]: ${this.message}`];
    if (this.context) {
      parts.push(`Context: ${JSON.stringify(this.context)}`);
    }
    return parts.join('\n');
  }
}

/**
 * Error codes for bridge errors
 */
export const ErrorCodes = {
  // Configuration errors
  CONFIG_INVALID: 'CONFIG_INVALID',
  CONFIG_MISSING: 'CONFIG_MISSING',
  CONFIG_PARSE_ERROR: 'CONFIG_PARSE_ERROR',

  // Connection errors
  CONNECTION_FAILED: 'CONNECTION_FAILED',
  CONNECTION_REFUSED: 'CONNECTION_REFUSED',
  CONNECTION_TIMEOUT: 'CONNECTION_TIMEOUT',
  CONNECTION_CLOSED: 'CONNECTION_CLOSED',
  NOT_CONNECTED: 'NOT_CONNECTED',
  ALREADY_CONNECTED: 'ALREADY_CONNECTED',

  // Peer errors
  PEER_NOT_FOUND: 'PEER_NOT_FOUND',
  NO_PEERS_CONNECTED: 'NO_PEERS_CONNECTED',
  PEER_DISCONNECTED: 'PEER_DISCONNECTED',

  // Task errors
  TASK_TIMEOUT: 'TASK_TIMEOUT',
  TASK_FAILED: 'TASK_FAILED',
  NO_TASK_HANDLER: 'NO_TASK_HANDLER',

  // Context errors
  CONTEXT_TIMEOUT: 'CONTEXT_TIMEOUT',
  CONTEXT_SYNC_FAILED: 'CONTEXT_SYNC_FAILED',
  SNAPSHOT_NOT_FOUND: 'SNAPSHOT_NOT_FOUND',

  // Protocol errors
  INVALID_MESSAGE: 'INVALID_MESSAGE',
  SERIALIZATION_ERROR: 'SERIALIZATION_ERROR',

  // Bridge lifecycle errors
  BRIDGE_ALREADY_STARTED: 'BRIDGE_ALREADY_STARTED',
  BRIDGE_NOT_STARTED: 'BRIDGE_NOT_STARTED',
  BRIDGE_SHUTDOWN: 'BRIDGE_SHUTDOWN',

  // General errors
  UNKNOWN: 'UNKNOWN',
} as const;

export type ErrorCode = typeof ErrorCodes[keyof typeof ErrorCodes];

/**
 * Configuration error
 */
export class ConfigurationError extends BridgeError {
  readonly setting?: string;

  constructor(message: string, code: ErrorCode, setting?: string, context?: Record<string, unknown>) {
    super(message, code, {
      ...context,
      setting,
    });
    this.name = 'ConfigurationError';
    this.setting = setting;
  }

  static missing(setting: string): ConfigurationError {
    return new ConfigurationError(
      `Missing required configuration: '${setting}'`,
      ErrorCodes.CONFIG_MISSING,
      setting
    );
  }

  static invalid(setting: string, reason: string, value?: unknown): ConfigurationError {
    return new ConfigurationError(
      `Invalid configuration for '${setting}': ${reason}`,
      ErrorCodes.CONFIG_INVALID,
      setting,
      { value }
    );
  }

  static parseError(filePath: string, error: Error): ConfigurationError {
    return new ConfigurationError(
      `Failed to parse configuration file '${filePath}': ${error.message}`,
      ErrorCodes.CONFIG_PARSE_ERROR,
      undefined,
      { filePath, originalError: error.message }
    );
  }
}

/**
 * Connection error with network details
 */
export class ConnectionError extends BridgeError {
  readonly url?: string;
  readonly host?: string;
  readonly port?: number;

  constructor(
    message: string,
    code: ErrorCode = ErrorCodes.CONNECTION_FAILED,
    options?: {
      url?: string;
      host?: string;
      port?: number;
      cause?: Error;
    }
  ) {
    super(message, code, {
      url: options?.url,
      host: options?.host,
      port: options?.port,
      cause: options?.cause?.message,
    });
    this.name = 'ConnectionError';
    this.url = options?.url;
    this.host = options?.host;
    this.port = options?.port;

    if (options?.cause) {
      this.cause = options.cause;
    }
  }

  static refused(url: string): ConnectionError {
    return new ConnectionError(
      `Connection refused to ${url}. Ensure the bridge is running and accepting connections.`,
      ErrorCodes.CONNECTION_REFUSED,
      { url }
    );
  }

  static timeout(url: string, timeoutMs: number): ConnectionError {
    return new ConnectionError(
      `Connection to ${url} timed out after ${timeoutMs}ms. Check network connectivity and firewall settings.`,
      ErrorCodes.CONNECTION_TIMEOUT,
      { url }
    );
  }

  static closed(url: string, reason?: string): ConnectionError {
    const message = reason
      ? `Connection to ${url} closed: ${reason}`
      : `Connection to ${url} closed unexpectedly`;
    return new ConnectionError(message, ErrorCodes.CONNECTION_CLOSED, { url });
  }

  static notConnected(): ConnectionError {
    return new ConnectionError(
      'Not connected to any peer. Call connect() first.',
      ErrorCodes.NOT_CONNECTED
    );
  }

  static alreadyConnected(): ConnectionError {
    return new ConnectionError(
      'Already connected. Disconnect first to establish a new connection.',
      ErrorCodes.ALREADY_CONNECTED
    );
  }
}

/**
 * Peer-related error
 */
export class PeerError extends BridgeError {
  readonly peerId?: string;

  constructor(message: string, code: ErrorCode, peerId?: string) {
    super(message, code, { peerId });
    this.name = 'PeerError';
    this.peerId = peerId;
  }

  static notFound(peerId: string): PeerError {
    return new PeerError(
      `Peer '${peerId}' not found. The peer may have disconnected.`,
      ErrorCodes.PEER_NOT_FOUND,
      peerId
    );
  }

  static noPeersConnected(): PeerError {
    return new PeerError(
      'No peers are connected. Wait for a peer to connect or call connectToPeer() first.',
      ErrorCodes.NO_PEERS_CONNECTED
    );
  }

  static disconnected(peerId: string): PeerError {
    return new PeerError(
      `Peer '${peerId}' has disconnected.`,
      ErrorCodes.PEER_DISCONNECTED,
      peerId
    );
  }
}

/**
 * Task-related error
 */
export class TaskError extends BridgeError {
  readonly taskId?: string;

  constructor(message: string, code: ErrorCode, taskId?: string, context?: Record<string, unknown>) {
    super(message, code, { ...context, taskId });
    this.name = 'TaskError';
    this.taskId = taskId;
  }

  static timeout(taskId: string, timeoutMs: number): TaskError {
    return new TaskError(
      `Task '${taskId}' timed out after ${timeoutMs}ms. Consider increasing the task timeout or breaking the task into smaller pieces.`,
      ErrorCodes.TASK_TIMEOUT,
      taskId,
      { timeoutMs }
    );
  }

  static failed(taskId: string, reason: string): TaskError {
    return new TaskError(
      `Task '${taskId}' failed: ${reason}`,
      ErrorCodes.TASK_FAILED,
      taskId
    );
  }

  static noHandler(): TaskError {
    return new TaskError(
      'No task handler registered. Register a handler with onTaskReceived() before delegating tasks.',
      ErrorCodes.NO_TASK_HANDLER
    );
  }
}

/**
 * Context synchronization error
 */
export class ContextError extends BridgeError {
  constructor(message: string, code: ErrorCode, context?: Record<string, unknown>) {
    super(message, code, context);
    this.name = 'ContextError';
  }

  static timeout(timeoutMs: number): ContextError {
    return new ContextError(
      `Context request timed out after ${timeoutMs}ms. The peer may be processing a large amount of data.`,
      ErrorCodes.CONTEXT_TIMEOUT,
      { timeoutMs }
    );
  }

  static syncFailed(reason: string): ContextError {
    return new ContextError(
      `Context synchronization failed: ${reason}`,
      ErrorCodes.CONTEXT_SYNC_FAILED
    );
  }

  static snapshotNotFound(snapshotId: string): ContextError {
    return new ContextError(
      `Snapshot '${snapshotId}' not found. It may have expired or never existed.`,
      ErrorCodes.SNAPSHOT_NOT_FOUND,
      { snapshotId }
    );
  }
}

/**
 * Protocol/message error
 */
export class ProtocolError extends BridgeError {
  constructor(message: string, code: ErrorCode = ErrorCodes.INVALID_MESSAGE, context?: Record<string, unknown>) {
    super(message, code, context);
    this.name = 'ProtocolError';
  }

  static invalidMessage(reason: string, data?: unknown): ProtocolError {
    return new ProtocolError(
      `Invalid message: ${reason}`,
      ErrorCodes.INVALID_MESSAGE,
      { data: data ? String(data).substring(0, 200) : undefined }
    );
  }

  static serializationError(error: Error): ProtocolError {
    return new ProtocolError(
      `Message serialization failed: ${error.message}`,
      ErrorCodes.SERIALIZATION_ERROR,
      { originalError: error.message }
    );
  }
}

/**
 * Bridge lifecycle error
 */
export class BridgeLifecycleError extends BridgeError {
  constructor(message: string, code: ErrorCode) {
    super(message, code);
    this.name = 'BridgeLifecycleError';
  }

  static alreadyStarted(): BridgeLifecycleError {
    return new BridgeLifecycleError(
      'Bridge is already started. Call stop() before starting again.',
      ErrorCodes.BRIDGE_ALREADY_STARTED
    );
  }

  static notStarted(): BridgeLifecycleError {
    return new BridgeLifecycleError(
      'Bridge is not started. Call start() first.',
      ErrorCodes.BRIDGE_NOT_STARTED
    );
  }

  static shuttingDown(): BridgeLifecycleError {
    return new BridgeLifecycleError(
      'Bridge is shutting down.',
      ErrorCodes.BRIDGE_SHUTDOWN
    );
  }
}

/**
 * Format an error for logging with context
 */
export function formatErrorForLogging(error: unknown): {
  message: string;
  code?: string;
  context?: Record<string, unknown>;
  stack?: string;
} {
  if (error instanceof BridgeError) {
    return {
      message: error.message,
      code: error.code,
      context: error.context,
      stack: error.stack,
    };
  }

  if (error instanceof Error) {
    return {
      message: error.message,
      stack: error.stack,
    };
  }

  return {
    message: String(error),
  };
}

/**
 * Wrap an error with additional context
 */
export function wrapError(error: unknown, context: string): BridgeError {
  if (error instanceof BridgeError) {
    return new BridgeError(
      `${context}: ${error.message}`,
      error.code,
      error.context
    );
  }

  const message = error instanceof Error ? error.message : String(error);
  return new BridgeError(
    `${context}: ${message}`,
    ErrorCodes.UNKNOWN,
    { originalError: message }
  );
}

/**
 * Check if an error is of a specific type
 */
export function isErrorCode(error: unknown, code: ErrorCode): boolean {
  return error instanceof BridgeError && error.code === code;
}
