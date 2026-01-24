import { describe, it, expect } from 'vitest';
import {
  BridgeMessageSchema,
  FileChunkSchema,
  DirectoryTreeSchema,
  TaskRequestSchema,
  TaskResultSchema,
  ContextSchema,
  ArtifactSchema,
  createMessage,
  validateMessage,
  safeValidateMessage,
  serializeMessage,
  deserializeMessage,
  safeDeserializeMessage,
  type BridgeMessage,
  type FileChunk,
  type DirectoryTree,
} from '../../../src/bridge/protocol.js';

describe('Protocol', () => {
  describe('FileChunkSchema', () => {
    it('should validate a complete file chunk', () => {
      const chunk: FileChunk = {
        path: 'src/index.ts',
        content: 'console.log("hello");',
        startLine: 1,
        endLine: 10,
        language: 'typescript',
      };
      const result = FileChunkSchema.safeParse(chunk);
      expect(result.success).toBe(true);
    });

    it('should validate a minimal file chunk', () => {
      const chunk = {
        path: 'test.txt',
        content: 'Hello world',
      };
      const result = FileChunkSchema.safeParse(chunk);
      expect(result.success).toBe(true);
    });

    it('should reject chunk without path', () => {
      const chunk = { content: 'Hello' };
      const result = FileChunkSchema.safeParse(chunk);
      expect(result.success).toBe(false);
    });

    it('should reject chunk without content', () => {
      const chunk = { path: 'test.txt' };
      const result = FileChunkSchema.safeParse(chunk);
      expect(result.success).toBe(false);
    });
  });

  describe('DirectoryTreeSchema', () => {
    it('should validate a file node', () => {
      const node: DirectoryTree = {
        name: 'index.ts',
        type: 'file',
      };
      const result = DirectoryTreeSchema.safeParse(node);
      expect(result.success).toBe(true);
    });

    it('should validate a directory with children', () => {
      const tree: DirectoryTree = {
        name: 'src',
        type: 'directory',
        children: [
          { name: 'index.ts', type: 'file' },
          {
            name: 'utils',
            type: 'directory',
            children: [{ name: 'helper.ts', type: 'file' }],
          },
        ],
      };
      const result = DirectoryTreeSchema.safeParse(tree);
      expect(result.success).toBe(true);
    });

    it('should reject invalid type', () => {
      const node = { name: 'test', type: 'invalid' };
      const result = DirectoryTreeSchema.safeParse(node);
      expect(result.success).toBe(false);
    });
  });

  describe('ArtifactSchema', () => {
    it('should validate artifact with diff', () => {
      const artifact = {
        path: 'src/index.ts',
        action: 'modified',
        diff: '+ new line\n- old line',
      };
      const result = ArtifactSchema.safeParse(artifact);
      expect(result.success).toBe(true);
    });

    it('should validate artifact without diff', () => {
      const artifact = {
        path: 'src/new.ts',
        action: 'created',
      };
      const result = ArtifactSchema.safeParse(artifact);
      expect(result.success).toBe(true);
    });

    it('should reject invalid action', () => {
      const artifact = {
        path: 'test.ts',
        action: 'unknown',
      };
      const result = ArtifactSchema.safeParse(artifact);
      expect(result.success).toBe(false);
    });
  });

  describe('TaskRequestSchema', () => {
    it('should validate complete task request', () => {
      const task = {
        id: 'task-123',
        description: 'Refactor the API client',
        scope: 'execute',
        constraints: ['No breaking changes', 'Add tests'],
        returnFormat: 'diff',
        timeout: 30000,
      };
      const result = TaskRequestSchema.safeParse(task);
      expect(result.success).toBe(true);
    });

    it('should validate minimal task request', () => {
      const task = {
        id: 'task-456',
        description: 'Do something',
        scope: 'analyze',
      };
      const result = TaskRequestSchema.safeParse(task);
      expect(result.success).toBe(true);
    });

    it('should reject invalid scope', () => {
      const task = {
        id: '1',
        description: 'test',
        scope: 'invalid',
      };
      const result = TaskRequestSchema.safeParse(task);
      expect(result.success).toBe(false);
    });
  });

  describe('TaskResultSchema', () => {
    it('should validate successful result', () => {
      const result = {
        taskId: 'task-123',
        success: true,
        data: { changes: ['file1.ts', 'file2.ts'] },
        artifacts: [{ path: 'file1.ts', action: 'modified' }],
      };
      const parsed = TaskResultSchema.safeParse(result);
      expect(parsed.success).toBe(true);
    });

    it('should validate failed result with error', () => {
      const result = {
        success: false,
        data: null,
        error: 'Task failed due to timeout',
      };
      const parsed = TaskResultSchema.safeParse(result);
      expect(parsed.success).toBe(true);
    });

    it('should validate result with follow-up', () => {
      const result = {
        success: true,
        data: { partial: true },
        followUp: 'Need more context about the API design',
      };
      const parsed = TaskResultSchema.safeParse(result);
      expect(parsed.success).toBe(true);
    });
  });

  describe('ContextSchema', () => {
    it('should validate context with files', () => {
      const context = {
        files: [{ path: 'test.ts', content: 'const x = 1;' }],
        summary: 'Test project context',
      };
      const result = ContextSchema.safeParse(context);
      expect(result.success).toBe(true);
    });

    it('should validate context with tree', () => {
      const context = {
        tree: { name: 'root', type: 'directory', children: [] },
        variables: { key: 'value' },
      };
      const result = ContextSchema.safeParse(context);
      expect(result.success).toBe(true);
    });

    it('should validate empty context', () => {
      const context = {};
      const result = ContextSchema.safeParse(context);
      expect(result.success).toBe(true);
    });
  });

  describe('BridgeMessageSchema', () => {
    it('should validate a correct message', () => {
      const msg: BridgeMessage = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        type: 'request',
        source: 'test-instance',
        timestamp: Date.now(),
      };
      const result = BridgeMessageSchema.safeParse(msg);
      expect(result.success).toBe(true);
    });

    it('should validate all message types', () => {
      const types = ['request', 'response', 'context_sync', 'task_delegate', 'notification'] as const;
      for (const type of types) {
        const msg = {
          id: '123e4567-e89b-12d3-a456-426614174000',
          type,
          source: 'test',
          timestamp: Date.now(),
        };
        const result = BridgeMessageSchema.safeParse(msg);
        expect(result.success).toBe(true);
      }
    });

    it('should reject invalid message type', () => {
      const msg = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        type: 'invalid',
        source: 'test',
        timestamp: Date.now(),
      };
      const result = BridgeMessageSchema.safeParse(msg);
      expect(result.success).toBe(false);
    });

    it('should reject invalid UUID format', () => {
      const msg = {
        id: 'not-a-uuid',
        type: 'request',
        source: 'test',
        timestamp: Date.now(),
      };
      const result = BridgeMessageSchema.safeParse(msg);
      expect(result.success).toBe(false);
    });

    it('should reject missing required fields', () => {
      const msg = { type: 'request', source: 'test' };
      const result = BridgeMessageSchema.safeParse(msg);
      expect(result.success).toBe(false);
    });

    it('should validate message with context', () => {
      const msg = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        type: 'context_sync',
        source: 'test',
        timestamp: Date.now(),
        context: {
          files: [{ path: 'test.ts', content: 'code' }],
          summary: 'Test context',
        },
      };
      const result = BridgeMessageSchema.safeParse(msg);
      expect(result.success).toBe(true);
    });

    it('should validate message with task', () => {
      const msg = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        type: 'task_delegate',
        source: 'test',
        timestamp: Date.now(),
        task: {
          id: 'task-1',
          description: 'Test task',
          scope: 'execute',
        },
      };
      const result = BridgeMessageSchema.safeParse(msg);
      expect(result.success).toBe(true);
    });

    it('should validate message with result', () => {
      const msg = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        type: 'response',
        source: 'test',
        timestamp: Date.now(),
        result: {
          taskId: 'task-1',
          success: true,
          data: { outcome: 'completed' },
        },
      };
      const result = BridgeMessageSchema.safeParse(msg);
      expect(result.success).toBe(true);
    });
  });

  describe('createMessage', () => {
    it('should create message with auto-generated UUID', () => {
      const msg = createMessage('request', 'test-source');
      expect(msg.id).toBeDefined();
      expect(msg.id.length).toBe(36); // UUID format: 8-4-4-4-12
      expect(msg.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    });

    it('should create message with correct type', () => {
      const msg = createMessage('notification', 'test');
      expect(msg.type).toBe('notification');
    });

    it('should create message with correct source', () => {
      const msg = createMessage('request', 'my-instance');
      expect(msg.source).toBe('my-instance');
    });

    it('should create message with current timestamp', () => {
      const before = Date.now();
      const msg = createMessage('request', 'test');
      const after = Date.now();
      expect(msg.timestamp).toBeGreaterThanOrEqual(before);
      expect(msg.timestamp).toBeLessThanOrEqual(after);
    });

    it('should create valid BridgeMessage', () => {
      const msg = createMessage('context_sync', 'test');
      const result = BridgeMessageSchema.safeParse(msg);
      expect(result.success).toBe(true);
    });
  });

  describe('validateMessage', () => {
    it('should return validated message for valid input', () => {
      const msg = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        type: 'request',
        source: 'test',
        timestamp: Date.now(),
      };
      const validated = validateMessage(msg);
      expect(validated).toEqual(msg);
    });

    it('should throw for invalid input', () => {
      const invalid = { foo: 'bar' };
      expect(() => validateMessage(invalid)).toThrow();
    });
  });

  describe('safeValidateMessage', () => {
    it('should return success for valid message', () => {
      const msg = createMessage('request', 'test');
      const result = safeValidateMessage(msg);
      expect(result.success).toBe(true);
    });

    it('should return error for invalid message', () => {
      const result = safeValidateMessage({ invalid: true });
      expect(result.success).toBe(false);
    });
  });

  describe('Serialization', () => {
    describe('serializeMessage', () => {
      it('should serialize message to JSON string', () => {
        const msg = createMessage('notification', 'test');
        const serialized = serializeMessage(msg);
        expect(typeof serialized).toBe('string');
        expect(() => JSON.parse(serialized)).not.toThrow();
      });

      it('should preserve all message fields', () => {
        const msg = createMessage('task_delegate', 'test');
        (msg as BridgeMessage).task = {
          id: 'task-1',
          description: 'Test task',
          scope: 'execute',
        };
        const serialized = serializeMessage(msg);
        const parsed = JSON.parse(serialized);
        expect(parsed.task).toEqual(msg.task);
      });
    });

    describe('deserializeMessage', () => {
      it('should deserialize valid JSON to message', () => {
        const original = createMessage('notification', 'test');
        const serialized = serializeMessage(original);
        const deserialized = deserializeMessage(serialized);
        expect(deserialized).toEqual(original);
      });

      it('should throw on invalid JSON', () => {
        expect(() => deserializeMessage('not json')).toThrow('Invalid JSON');
      });

      it('should throw on valid JSON with invalid structure', () => {
        expect(() => deserializeMessage('{"foo": "bar"}')).toThrow();
      });

      it('should handle message with all optional fields', () => {
        const msg = {
          id: '123e4567-e89b-12d3-a456-426614174000',
          type: 'context_sync',
          source: 'test',
          timestamp: Date.now(),
          context: {
            files: [{ path: 'test.ts', content: 'const x = 1;' }],
            tree: { name: 'root', type: 'directory', children: [] },
            summary: 'Test summary',
            variables: { env: 'test' },
          },
        };
        const serialized = JSON.stringify(msg);
        const deserialized = deserializeMessage(serialized);
        expect(deserialized.context).toEqual(msg.context);
      });
    });

    describe('safeDeserializeMessage', () => {
      it('should return success for valid JSON message', () => {
        const msg = createMessage('request', 'test');
        const json = JSON.stringify(msg);
        const result = safeDeserializeMessage(json);
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data).toEqual(msg);
        }
      });

      it('should return error for invalid JSON', () => {
        const result = safeDeserializeMessage('not json');
        expect(result.success).toBe(false);
      });

      it('should return error for valid JSON with invalid structure', () => {
        const result = safeDeserializeMessage('{"invalid": true}');
        expect(result.success).toBe(false);
      });
    });
  });

  describe('Round-trip serialization', () => {
    it('should preserve message integrity through serialize/deserialize', () => {
      const original: BridgeMessage = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        type: 'response',
        source: 'test-instance',
        timestamp: 1706000000000,
        result: {
          taskId: 'task-123',
          success: true,
          data: { files: ['a.ts', 'b.ts'] },
          artifacts: [
            { path: 'a.ts', action: 'modified', diff: '+new line' },
          ],
        },
      };

      const roundTripped = deserializeMessage(serializeMessage(original));
      expect(roundTripped).toEqual(original);
    });
  });
});
