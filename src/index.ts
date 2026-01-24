/**
 * Claude Code Bridge
 *
 * A bidirectional communication system that enables two separate Claude Code instances
 * to collaborate across different environments. Connect instances running on different
 * machines, containers, or networks via WebSocket.
 *
 * @packageDocumentation
 */

export const VERSION = '0.1.0';

// ============================================================================
// Bridge Core
// ============================================================================

export {
  // Main Bridge class
  Bridge,
  // Bridge types
  type BridgeMode,
  type BridgeConfig,
  type BridgeListenConfig,
  type BridgeConnectConfig,
  type ContextSharingConfig,
  type PeerInfo,
  // Handler types
  type PeerConnectedHandler,
  type PeerDisconnectedHandler,
  type MessageReceivedHandler,
  type TaskReceivedHandler,
  type ContextReceivedHandler,
  type ContextRequestedHandler,
} from './bridge/core.js';

// ============================================================================
// Protocol & Messages
// ============================================================================

export {
  // Schemas (for validation)
  MessageType,
  FileChunkSchema,
  DirectoryTreeSchema,
  ArtifactSchema,
  ContextSchema,
  TaskRequestSchema,
  TaskResultSchema,
  BridgeMessageSchema,
  // Protocol types
  type FileChunk,
  type DirectoryTree,
  type Artifact,
  type Context,
  type TaskRequest,
  type TaskResult,
  type BridgeMessage,
  // Helper functions
  createMessage,
  validateMessage,
  safeValidateMessage,
  serializeMessage,
  deserializeMessage,
  safeDeserializeMessage,
} from './bridge/protocol.js';

export {
  // Message builders
  createContextSyncMessage,
  createTaskDelegateMessage,
  createTaskResponseMessage,
  createContextRequestMessage,
  createNotificationMessage,
  type NotificationData,
} from './bridge/messages.js';

// ============================================================================
// Context Management
// ============================================================================

export {
  ContextManager,
  buildDirectoryTree,
  type ContextManagerOptions,
  type ProjectSnapshot,
  type BuildDirectoryTreeOptions,
  type ContextDelta,
  type FileChange,
} from './bridge/context.js';

// ============================================================================
// Transport Layer
// ============================================================================

export {
  // Transport interface
  type Transport,
  type ConnectionConfig,
  ConnectionState,
  // Transport implementation
  WebSocketTransport,
  // Factory
  createTransport,
} from './transport/index.js';


// ============================================================================
// Utilities
// ============================================================================

export {
  // Logger
  createLogger,
  createChildLogger,
  type Logger,
  type LogLevel,
  // Configuration
  loadConfig,
  loadConfigSync,
  mergeConfig,
  DEFAULT_CONFIG,
  type BridgeConfig as UtilsBridgeConfig,
  type ListenConfig,
  type ConnectConfig,
  type ContextSharingConfig as UtilsContextSharingConfig,
  type InteractionConfig,
  // Tokens
  estimateTokens,
  truncateToTokenLimit,
  // Errors
  BridgeError,
  ConfigurationError,
  ConnectionError,
  PeerError,
  TaskError,
  ContextError,
  ProtocolError,
  BridgeLifecycleError,
  ErrorCodes,
  formatErrorForLogging,
  wrapError,
  isErrorCode,
  type ErrorCode,
} from './utils/index.js';

// ============================================================================
// MCP Server
// ============================================================================

export {
  BridgeMcpServer,
  startMcpServer,
  type McpServerConfig,
  TOOL_DEFINITIONS,
  createToolHandlers,
  type ToolDefinition,
  type ToolResponse,
} from './mcp/index.js';
