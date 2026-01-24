/**
 * Unit tests for custom error classes
 */

import { describe, it, expect } from 'vitest';
import {
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
} from '../../../src/utils/errors.js';

describe('Error Classes', () => {
  describe('BridgeError', () => {
    it('should create error with message and code', () => {
      const error = new BridgeError('Test error', ErrorCodes.UNKNOWN);

      expect(error.message).toBe('Test error');
      expect(error.code).toBe('UNKNOWN');
      expect(error.name).toBe('BridgeError');
      expect(error).toBeInstanceOf(Error);
    });

    it('should include context', () => {
      const error = new BridgeError('Test error', ErrorCodes.UNKNOWN, { key: 'value' });

      expect(error.context).toEqual({ key: 'value' });
    });

    it('should format detailed string', () => {
      const error = new BridgeError('Test error', ErrorCodes.UNKNOWN, { key: 'value' });
      const detailed = error.toDetailedString();

      expect(detailed).toContain('BridgeError');
      expect(detailed).toContain('UNKNOWN');
      expect(detailed).toContain('Test error');
      expect(detailed).toContain('key');
    });
  });

  describe('ConfigurationError', () => {
    it('should create error for missing setting', () => {
      const error = ConfigurationError.missing('listen.port');

      expect(error.message).toContain('Missing required configuration');
      expect(error.message).toContain('listen.port');
      expect(error.code).toBe(ErrorCodes.CONFIG_MISSING);
      expect(error.setting).toBe('listen.port');
    });

    it('should create error for invalid setting', () => {
      const error = ConfigurationError.invalid('port', 'must be a number', 'abc');

      expect(error.message).toContain('Invalid configuration');
      expect(error.message).toContain('port');
      expect(error.message).toContain('must be a number');
      expect(error.code).toBe(ErrorCodes.CONFIG_INVALID);
      expect(error.context?.value).toBe('abc');
    });

    it('should create error for parse error', () => {
      const originalError = new Error('Unexpected token');
      const error = ConfigurationError.parseError('/path/to/config.yml', originalError);

      expect(error.message).toContain('Failed to parse');
      expect(error.message).toContain('/path/to/config.yml');
      expect(error.code).toBe(ErrorCodes.CONFIG_PARSE_ERROR);
    });
  });

  describe('ConnectionError', () => {
    it('should create refused error', () => {
      const error = ConnectionError.refused('ws://localhost:8765');

      expect(error.message).toContain('Connection refused');
      expect(error.message).toContain('ws://localhost:8765');
      expect(error.code).toBe(ErrorCodes.CONNECTION_REFUSED);
      expect(error.url).toBe('ws://localhost:8765');
    });

    it('should create timeout error', () => {
      const error = ConnectionError.timeout('ws://localhost:8765', 5000);

      expect(error.message).toContain('timed out');
      expect(error.message).toContain('5000ms');
      expect(error.code).toBe(ErrorCodes.CONNECTION_TIMEOUT);
    });

    it('should create closed error with reason', () => {
      const error = ConnectionError.closed('ws://localhost:8765', 'Server shutdown');

      expect(error.message).toContain('closed');
      expect(error.message).toContain('Server shutdown');
      expect(error.code).toBe(ErrorCodes.CONNECTION_CLOSED);
    });

    it('should create not connected error', () => {
      const error = ConnectionError.notConnected();

      expect(error.message).toContain('Not connected');
      expect(error.code).toBe(ErrorCodes.NOT_CONNECTED);
    });

    it('should create already connected error', () => {
      const error = ConnectionError.alreadyConnected();

      expect(error.message).toContain('Already connected');
      expect(error.code).toBe(ErrorCodes.ALREADY_CONNECTED);
    });
  });

  describe('PeerError', () => {
    it('should create not found error', () => {
      const error = PeerError.notFound('peer-123');

      expect(error.message).toContain("Peer 'peer-123' not found");
      expect(error.code).toBe(ErrorCodes.PEER_NOT_FOUND);
      expect(error.peerId).toBe('peer-123');
    });

    it('should create no peers connected error', () => {
      const error = PeerError.noPeersConnected();

      expect(error.message).toContain('No peers are connected');
      expect(error.code).toBe(ErrorCodes.NO_PEERS_CONNECTED);
    });

    it('should create disconnected error', () => {
      const error = PeerError.disconnected('peer-456');

      expect(error.message).toContain("Peer 'peer-456' has disconnected");
      expect(error.code).toBe(ErrorCodes.PEER_DISCONNECTED);
    });
  });

  describe('TaskError', () => {
    it('should create timeout error', () => {
      const error = TaskError.timeout('task-123', 30000);

      expect(error.message).toContain("Task 'task-123' timed out");
      expect(error.message).toContain('30000ms');
      expect(error.code).toBe(ErrorCodes.TASK_TIMEOUT);
      expect(error.taskId).toBe('task-123');
    });

    it('should create failed error', () => {
      const error = TaskError.failed('task-456', 'File not found');

      expect(error.message).toContain("Task 'task-456' failed");
      expect(error.message).toContain('File not found');
      expect(error.code).toBe(ErrorCodes.TASK_FAILED);
    });

    it('should create no handler error', () => {
      const error = TaskError.noHandler();

      expect(error.message).toContain('No task handler registered');
      expect(error.code).toBe(ErrorCodes.NO_TASK_HANDLER);
    });
  });

  describe('ContextError', () => {
    it('should create timeout error', () => {
      const error = ContextError.timeout(5000);

      expect(error.message).toContain('Context request timed out');
      expect(error.message).toContain('5000ms');
      expect(error.code).toBe(ErrorCodes.CONTEXT_TIMEOUT);
    });

    it('should create sync failed error', () => {
      const error = ContextError.syncFailed('Network error');

      expect(error.message).toContain('Context synchronization failed');
      expect(error.message).toContain('Network error');
      expect(error.code).toBe(ErrorCodes.CONTEXT_SYNC_FAILED);
    });

    it('should create snapshot not found error', () => {
      const error = ContextError.snapshotNotFound('snap-123');

      expect(error.message).toContain("Snapshot 'snap-123' not found");
      expect(error.code).toBe(ErrorCodes.SNAPSHOT_NOT_FOUND);
    });
  });

  describe('ProtocolError', () => {
    it('should create invalid message error', () => {
      const error = ProtocolError.invalidMessage('Missing type field');

      expect(error.message).toContain('Invalid message');
      expect(error.message).toContain('Missing type field');
      expect(error.code).toBe(ErrorCodes.INVALID_MESSAGE);
    });

    it('should create serialization error', () => {
      const original = new Error('Circular reference');
      const error = ProtocolError.serializationError(original);

      expect(error.message).toContain('Message serialization failed');
      expect(error.message).toContain('Circular reference');
      expect(error.code).toBe(ErrorCodes.SERIALIZATION_ERROR);
    });
  });

  describe('BridgeLifecycleError', () => {
    it('should create already started error', () => {
      const error = BridgeLifecycleError.alreadyStarted();

      expect(error.message).toContain('already started');
      expect(error.code).toBe(ErrorCodes.BRIDGE_ALREADY_STARTED);
    });

    it('should create not started error', () => {
      const error = BridgeLifecycleError.notStarted();

      expect(error.message).toContain('not started');
      expect(error.code).toBe(ErrorCodes.BRIDGE_NOT_STARTED);
    });

    it('should create shutting down error', () => {
      const error = BridgeLifecycleError.shuttingDown();

      expect(error.message).toContain('shutting down');
      expect(error.code).toBe(ErrorCodes.BRIDGE_SHUTDOWN);
    });
  });
});

describe('Error Utilities', () => {
  describe('formatErrorForLogging', () => {
    it('should format BridgeError', () => {
      const error = new BridgeError('Test error', ErrorCodes.UNKNOWN, { key: 'value' });
      const formatted = formatErrorForLogging(error);

      expect(formatted.message).toBe('Test error');
      expect(formatted.code).toBe('UNKNOWN');
      expect(formatted.context).toEqual({ key: 'value' });
      expect(formatted.stack).toBeDefined();
    });

    it('should format regular Error', () => {
      const error = new Error('Regular error');
      const formatted = formatErrorForLogging(error);

      expect(formatted.message).toBe('Regular error');
      expect(formatted.code).toBeUndefined();
      expect(formatted.stack).toBeDefined();
    });

    it('should format string', () => {
      const formatted = formatErrorForLogging('String error');

      expect(formatted.message).toBe('String error');
    });
  });

  describe('wrapError', () => {
    it('should wrap BridgeError with context', () => {
      const original = new BridgeError('Original error', ErrorCodes.CONNECTION_FAILED);
      const wrapped = wrapError(original, 'While connecting');

      expect(wrapped.message).toBe('While connecting: Original error');
      expect(wrapped.code).toBe(ErrorCodes.CONNECTION_FAILED);
    });

    it('should wrap regular Error', () => {
      const original = new Error('Regular error');
      const wrapped = wrapError(original, 'Operation failed');

      expect(wrapped.message).toBe('Operation failed: Regular error');
      expect(wrapped.code).toBe(ErrorCodes.UNKNOWN);
    });

    it('should wrap string', () => {
      const wrapped = wrapError('String error', 'Something went wrong');

      expect(wrapped.message).toBe('Something went wrong: String error');
      expect(wrapped.code).toBe(ErrorCodes.UNKNOWN);
    });
  });

  describe('isErrorCode', () => {
    it('should return true for matching error code', () => {
      const error = new ConnectionError('Test', ErrorCodes.CONNECTION_REFUSED);

      expect(isErrorCode(error, ErrorCodes.CONNECTION_REFUSED)).toBe(true);
    });

    it('should return false for non-matching error code', () => {
      const error = new ConnectionError('Test', ErrorCodes.CONNECTION_REFUSED);

      expect(isErrorCode(error, ErrorCodes.CONNECTION_TIMEOUT)).toBe(false);
    });

    it('should return false for regular Error', () => {
      const error = new Error('Test');

      expect(isErrorCode(error, ErrorCodes.UNKNOWN)).toBe(false);
    });

    it('should return false for non-Error', () => {
      expect(isErrorCode('string', ErrorCodes.UNKNOWN)).toBe(false);
    });
  });
});
