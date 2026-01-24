import { describe, it, expect } from 'vitest';
import {
  createContextSyncMessage,
  createTaskDelegateMessage,
  createTaskResponseMessage,
  createContextRequestMessage,
  createNotificationMessage,
  type NotificationData,
} from '../../../src/bridge/messages.js';
import {
  BridgeMessageSchema,
  type Context,
  type TaskRequest,
} from '../../../src/bridge/protocol.js';

describe('Message Builders', () => {
  describe('createContextSyncMessage', () => {
    it('should create message with type context_sync', () => {
      const context: Context = {
        files: [{ path: 'src/index.ts', content: 'console.log("hi")' }],
      };
      const msg = createContextSyncMessage('source-1', context);
      expect(msg.type).toBe('context_sync');
    });

    it('should include the provided context', () => {
      const context: Context = {
        files: [{ path: 'test.ts', content: 'const x = 1;' }],
        summary: 'Test context',
      };
      const msg = createContextSyncMessage('source-1', context);
      expect(msg.context).toEqual(context);
    });

    it('should include files in context', () => {
      const msg = createContextSyncMessage('source-1', {
        files: [{ path: 'src/index.ts', content: 'console.log("hi")' }],
      });
      expect(msg.context?.files).toHaveLength(1);
      expect(msg.context?.files?.[0].path).toBe('src/index.ts');
    });

    it('should include directory tree in context', () => {
      const msg = createContextSyncMessage('source-1', {
        tree: {
          name: 'src',
          type: 'directory',
          children: [{ name: 'index.ts', type: 'file' }],
        },
      });
      expect(msg.context?.tree?.name).toBe('src');
      expect(msg.context?.tree?.type).toBe('directory');
    });

    it('should include summary in context', () => {
      const msg = createContextSyncMessage('source-1', {
        summary: 'Project overview',
      });
      expect(msg.context?.summary).toBe('Project overview');
    });

    it('should include variables in context', () => {
      const msg = createContextSyncMessage('source-1', {
        variables: { env: 'development', version: '1.0.0' },
      });
      expect(msg.context?.variables).toEqual({ env: 'development', version: '1.0.0' });
    });

    it('should generate valid UUID', () => {
      const msg = createContextSyncMessage('source-1', {});
      expect(msg.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    });

    it('should set correct source', () => {
      const msg = createContextSyncMessage('my-instance', {});
      expect(msg.source).toBe('my-instance');
    });

    it('should set current timestamp', () => {
      const before = Date.now();
      const msg = createContextSyncMessage('source-1', {});
      const after = Date.now();
      expect(msg.timestamp).toBeGreaterThanOrEqual(before);
      expect(msg.timestamp).toBeLessThanOrEqual(after);
    });

    it('should return valid BridgeMessage', () => {
      const msg = createContextSyncMessage('source-1', {
        files: [{ path: 'test.ts', content: 'code' }],
      });
      const result = BridgeMessageSchema.safeParse(msg);
      expect(result.success).toBe(true);
    });
  });

  describe('createTaskDelegateMessage', () => {
    const baseTask: TaskRequest = {
      id: 'task-1',
      description: 'Refactor the API client',
      scope: 'execute',
    };

    it('should create message with type task_delegate', () => {
      const msg = createTaskDelegateMessage('source-1', baseTask);
      expect(msg.type).toBe('task_delegate');
    });

    it('should include the provided task', () => {
      const msg = createTaskDelegateMessage('source-1', baseTask);
      expect(msg.task).toEqual(baseTask);
    });

    it('should include task description', () => {
      const msg = createTaskDelegateMessage('source-1', baseTask);
      expect(msg.task?.description).toBe('Refactor the API client');
    });

    it('should include task scope', () => {
      const msg = createTaskDelegateMessage('source-1', {
        id: 'task-2',
        description: 'Analyze code',
        scope: 'analyze',
      });
      expect(msg.task?.scope).toBe('analyze');
    });

    it('should include task constraints', () => {
      const task: TaskRequest = {
        ...baseTask,
        constraints: ['No breaking changes', 'Add tests'],
      };
      const msg = createTaskDelegateMessage('source-1', task);
      expect(msg.task?.constraints).toEqual(['No breaking changes', 'Add tests']);
    });

    it('should include task returnFormat', () => {
      const task: TaskRequest = {
        ...baseTask,
        returnFormat: 'diff',
      };
      const msg = createTaskDelegateMessage('source-1', task);
      expect(msg.task?.returnFormat).toBe('diff');
    });

    it('should include task timeout', () => {
      const task: TaskRequest = {
        ...baseTask,
        timeout: 30000,
      };
      const msg = createTaskDelegateMessage('source-1', task);
      expect(msg.task?.timeout).toBe(30000);
    });

    it('should generate valid UUID', () => {
      const msg = createTaskDelegateMessage('source-1', baseTask);
      expect(msg.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    });

    it('should set correct source', () => {
      const msg = createTaskDelegateMessage('my-instance', baseTask);
      expect(msg.source).toBe('my-instance');
    });

    it('should set current timestamp', () => {
      const before = Date.now();
      const msg = createTaskDelegateMessage('source-1', baseTask);
      const after = Date.now();
      expect(msg.timestamp).toBeGreaterThanOrEqual(before);
      expect(msg.timestamp).toBeLessThanOrEqual(after);
    });

    it('should return valid BridgeMessage', () => {
      const msg = createTaskDelegateMessage('source-1', baseTask);
      const result = BridgeMessageSchema.safeParse(msg);
      expect(result.success).toBe(true);
    });
  });

  describe('createTaskResponseMessage', () => {
    it('should create message with type response', () => {
      const msg = createTaskResponseMessage('source-1', 'task-1', {
        success: true,
        data: {},
      });
      expect(msg.type).toBe('response');
    });

    it('should include taskId in result', () => {
      const msg = createTaskResponseMessage('source-1', 'task-123', {
        success: true,
        data: {},
      });
      expect(msg.result?.taskId).toBe('task-123');
    });

    it('should include success status in result', () => {
      const msg = createTaskResponseMessage('source-1', 'task-1', {
        success: true,
        data: { completed: true },
      });
      expect(msg.result?.success).toBe(true);
    });

    it('should include data in result', () => {
      const data = { changes: ['file1.ts', 'file2.ts'] };
      const msg = createTaskResponseMessage('source-1', 'task-1', {
        success: true,
        data,
      });
      expect(msg.result?.data).toEqual(data);
    });

    it('should include artifacts in result', () => {
      const msg = createTaskResponseMessage('source-1', 'task-1', {
        success: true,
        data: {},
        artifacts: [
          { path: 'src/index.ts', action: 'modified', diff: '+line' },
        ],
      });
      expect(msg.result?.artifacts).toHaveLength(1);
      expect(msg.result?.artifacts?.[0].action).toBe('modified');
    });

    it('should include error in failed result', () => {
      const msg = createTaskResponseMessage('source-1', 'task-1', {
        success: false,
        data: null,
        error: 'Task failed due to timeout',
      });
      expect(msg.result?.success).toBe(false);
      expect(msg.result?.error).toBe('Task failed due to timeout');
    });

    it('should include followUp in result', () => {
      const msg = createTaskResponseMessage('source-1', 'task-1', {
        success: true,
        data: { partial: true },
        followUp: 'Need more context about the API design',
      });
      expect(msg.result?.followUp).toBe('Need more context about the API design');
    });

    it('should generate valid UUID', () => {
      const msg = createTaskResponseMessage('source-1', 'task-1', {
        success: true,
        data: {},
      });
      expect(msg.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    });

    it('should set correct source', () => {
      const msg = createTaskResponseMessage('my-instance', 'task-1', {
        success: true,
        data: {},
      });
      expect(msg.source).toBe('my-instance');
    });

    it('should set current timestamp', () => {
      const before = Date.now();
      const msg = createTaskResponseMessage('source-1', 'task-1', {
        success: true,
        data: {},
      });
      const after = Date.now();
      expect(msg.timestamp).toBeGreaterThanOrEqual(before);
      expect(msg.timestamp).toBeLessThanOrEqual(after);
    });

    it('should return valid BridgeMessage', () => {
      const msg = createTaskResponseMessage('source-1', 'task-1', {
        success: true,
        data: { result: 'completed' },
      });
      const result = BridgeMessageSchema.safeParse(msg);
      expect(result.success).toBe(true);
    });
  });

  describe('createContextRequestMessage', () => {
    it('should create message with type request', () => {
      const msg = createContextRequestMessage('source-1', 'get config files');
      expect(msg.type).toBe('request');
    });

    it('should include query in context.summary', () => {
      const msg = createContextRequestMessage('source-1', 'find all TypeScript files');
      expect(msg.context?.summary).toBe('find all TypeScript files');
    });

    it('should generate valid UUID', () => {
      const msg = createContextRequestMessage('source-1', 'query');
      expect(msg.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    });

    it('should set correct source', () => {
      const msg = createContextRequestMessage('my-instance', 'query');
      expect(msg.source).toBe('my-instance');
    });

    it('should set current timestamp', () => {
      const before = Date.now();
      const msg = createContextRequestMessage('source-1', 'query');
      const after = Date.now();
      expect(msg.timestamp).toBeGreaterThanOrEqual(before);
      expect(msg.timestamp).toBeLessThanOrEqual(after);
    });

    it('should return valid BridgeMessage', () => {
      const msg = createContextRequestMessage('source-1', 'get API endpoints');
      const result = BridgeMessageSchema.safeParse(msg);
      expect(result.success).toBe(true);
    });
  });

  describe('createNotificationMessage', () => {
    const baseNotification: NotificationData = {
      type: 'info',
      message: 'Test notification',
    };

    it('should create message with type notification', () => {
      const msg = createNotificationMessage('source-1', baseNotification);
      expect(msg.type).toBe('notification');
    });

    it('should include notification message in context.summary', () => {
      const msg = createNotificationMessage('source-1', {
        type: 'warning',
        message: 'Connection unstable',
      });
      expect(msg.context?.summary).toBe('Connection unstable');
    });

    it('should include notification type in context.variables', () => {
      const msg = createNotificationMessage('source-1', {
        type: 'error',
        message: 'Failed to sync',
      });
      expect(msg.context?.variables?.notificationType).toBe('error');
    });

    it('should include additional data in context.variables', () => {
      const msg = createNotificationMessage('source-1', {
        type: 'info',
        message: 'Sync completed',
        data: { filesProcessed: 10, duration: 500 },
      });
      expect(msg.context?.variables?.filesProcessed).toBe(10);
      expect(msg.context?.variables?.duration).toBe(500);
    });

    it('should generate valid UUID', () => {
      const msg = createNotificationMessage('source-1', baseNotification);
      expect(msg.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    });

    it('should set correct source', () => {
      const msg = createNotificationMessage('my-instance', baseNotification);
      expect(msg.source).toBe('my-instance');
    });

    it('should set current timestamp', () => {
      const before = Date.now();
      const msg = createNotificationMessage('source-1', baseNotification);
      const after = Date.now();
      expect(msg.timestamp).toBeGreaterThanOrEqual(before);
      expect(msg.timestamp).toBeLessThanOrEqual(after);
    });

    it('should return valid BridgeMessage', () => {
      const msg = createNotificationMessage('source-1', {
        type: 'status',
        message: 'Bridge is running',
        data: { uptime: 3600 },
      });
      const result = BridgeMessageSchema.safeParse(msg);
      expect(result.success).toBe(true);
    });
  });

  describe('Message Builder Integration', () => {
    it('should create unique IDs for different messages', () => {
      const msg1 = createContextSyncMessage('source', {});
      const msg2 = createTaskDelegateMessage('source', {
        id: '1',
        description: 'test',
        scope: 'execute',
      });
      const msg3 = createNotificationMessage('source', {
        type: 'info',
        message: 'test',
      });

      const ids = new Set([msg1.id, msg2.id, msg3.id]);
      expect(ids.size).toBe(3);
    });

    it('should all pass BridgeMessageSchema validation', () => {
      const messages = [
        createContextSyncMessage('source', { summary: 'test' }),
        createTaskDelegateMessage('source', {
          id: 'task-1',
          description: 'test',
          scope: 'analyze',
        }),
        createTaskResponseMessage('source', 'task-1', {
          success: true,
          data: {},
        }),
        createContextRequestMessage('source', 'query'),
        createNotificationMessage('source', {
          type: 'info',
          message: 'test',
        }),
      ];

      for (const msg of messages) {
        const result = BridgeMessageSchema.safeParse(msg);
        expect(result.success).toBe(true);
      }
    });
  });
});
