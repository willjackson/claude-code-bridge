/**
 * Protocol definitions for Claude Code Bridge
 * Defines message types, schemas, and serialization utilities
 */

import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';

// ============================================================================
// Message Type Enum
// ============================================================================

export const MessageType = z.enum([
  'request',
  'response',
  'context_sync',
  'task_delegate',
  'notification',
]);

export type MessageType = z.infer<typeof MessageType>;

// ============================================================================
// File and Directory Schemas
// ============================================================================

export const FileChunkSchema = z.object({
  path: z.string(),
  content: z.string(),
  startLine: z.number().optional(),
  endLine: z.number().optional(),
  language: z.string().optional(),
});

export type FileChunk = z.infer<typeof FileChunkSchema>;

export const DirectoryTreeSchema: z.ZodType<DirectoryTree> = z.lazy(() =>
  z.object({
    name: z.string(),
    type: z.enum(['file', 'directory']),
    children: z.array(DirectoryTreeSchema).optional(),
  })
);

export interface DirectoryTree {
  name: string;
  type: 'file' | 'directory';
  children?: DirectoryTree[];
}

// ============================================================================
// Artifact Schema
// ============================================================================

export const ArtifactSchema = z.object({
  path: z.string(),
  action: z.enum(['created', 'modified', 'deleted']),
  diff: z.string().optional(),
});

export type Artifact = z.infer<typeof ArtifactSchema>;

// ============================================================================
// Context Schema
// ============================================================================

export const ContextSchema = z.object({
  files: z.array(FileChunkSchema).optional(),
  tree: DirectoryTreeSchema.optional(),
  summary: z.string().optional(),
  variables: z.record(z.any()).optional(),
});

export type Context = z.infer<typeof ContextSchema>;

// ============================================================================
// Task Request Schema
// ============================================================================

export const TaskRequestSchema = z.object({
  id: z.string(),
  description: z.string(),
  scope: z.enum(['execute', 'analyze', 'suggest']),
  constraints: z.array(z.string()).optional(),
  returnFormat: z.enum(['full', 'summary', 'diff']).optional(),
  timeout: z.number().optional(),
  data: z.record(z.unknown()).optional(),
});

export type TaskRequest = z.infer<typeof TaskRequestSchema>;

// ============================================================================
// Task Result Schema
// ============================================================================

export const TaskResultSchema = z.object({
  taskId: z.string().optional(),
  success: z.boolean(),
  data: z.any(),
  artifacts: z.array(ArtifactSchema).optional(),
  followUp: z.string().optional(),
  error: z.string().optional(),
});

export type TaskResult = z.infer<typeof TaskResultSchema>;

// ============================================================================
// Bridge Message Schema
// ============================================================================

export const BridgeMessageSchema = z.object({
  id: z.string().uuid(),
  type: MessageType,
  source: z.string(),
  timestamp: z.number(),
  context: ContextSchema.optional(),
  task: TaskRequestSchema.optional(),
  result: TaskResultSchema.optional(),
});

export type BridgeMessage = z.infer<typeof BridgeMessageSchema>;

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Creates a base message with auto-generated UUID and timestamp
 * @param type The message type
 * @param source The source instance identifier
 * @returns A partial BridgeMessage with id, type, source, and timestamp
 */
export function createMessage(
  type: MessageType,
  source: string
): BridgeMessage {
  return {
    id: uuidv4(),
    type,
    source,
    timestamp: Date.now(),
  };
}

/**
 * Validates a message against the BridgeMessage schema
 * @param data The data to validate
 * @returns The validated BridgeMessage or throws if invalid
 */
export function validateMessage(data: unknown): BridgeMessage {
  return BridgeMessageSchema.parse(data);
}

/**
 * Safe validation that returns a result object instead of throwing
 * @param data The data to validate
 * @returns A Zod SafeParseReturnType with success/error information
 */
export function safeValidateMessage(data: unknown) {
  return BridgeMessageSchema.safeParse(data);
}

/**
 * Serializes a BridgeMessage to JSON string
 * @param message The message to serialize
 * @returns JSON string representation
 */
export function serializeMessage(message: BridgeMessage): string {
  return JSON.stringify(message);
}

/**
 * Deserializes a JSON string to a validated BridgeMessage
 * @param json The JSON string to deserialize
 * @returns The validated BridgeMessage
 * @throws Error if JSON is invalid or message doesn't match schema
 */
export function deserializeMessage(json: string): BridgeMessage {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error('Invalid JSON');
  }
  return validateMessage(parsed);
}

/**
 * Safe deserialization that returns a result object instead of throwing
 * @param json The JSON string to deserialize
 * @returns A Zod SafeParseReturnType with success/error information
 */
export function safeDeserializeMessage(json: string) {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return {
      success: false as const,
      error: new z.ZodError([
        {
          code: 'custom',
          message: 'Invalid JSON',
          path: [],
        },
      ]),
    };
  }
  return BridgeMessageSchema.safeParse(parsed);
}
