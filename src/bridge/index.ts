/**
 * Bridge module exports
 */

export {
  // Schemas
  MessageType,
  FileChunkSchema,
  DirectoryTreeSchema,
  ArtifactSchema,
  ContextSchema,
  TaskRequestSchema,
  TaskResultSchema,
  BridgeMessageSchema,
  // Types
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
} from './protocol.js';

export {
  // Message builders
  createContextSyncMessage,
  createTaskDelegateMessage,
  createTaskResponseMessage,
  createContextRequestMessage,
  createNotificationMessage,
  // Types
  type NotificationData,
} from './messages.js';

export {
  // Context Manager
  ContextManager,
  // Standalone functions
  buildDirectoryTree,
  // Types
  type ContextManagerOptions,
  type ProjectSnapshot,
  type BuildDirectoryTreeOptions,
  type ContextDelta,
  type FileChange,
} from './context.js';

export {
  // Bridge Core
  Bridge,
  // Types
  type BridgeMode,
  type BridgeConfig,
  type BridgeListenConfig,
  type BridgeConnectConfig,
  type ContextSharingConfig,
  type PeerInfo,
  type PeerConnectedHandler,
  type PeerDisconnectedHandler,
  type MessageReceivedHandler,
  type TaskReceivedHandler,
  type ContextReceivedHandler,
  type ContextRequestedHandler,
} from './core.js';
