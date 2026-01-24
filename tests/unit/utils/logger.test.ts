import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createLogger, createChildLogger, type LogLevel } from '../../../src/utils/logger';

describe('Logger', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('createLogger', () => {
    it('should create a logger instance', () => {
      const logger = createLogger('test');
      expect(logger).toBeDefined();
      expect(logger.info).toBeDefined();
      expect(logger.error).toBeDefined();
      expect(logger.warn).toBeDefined();
      expect(logger.debug).toBeDefined();
    });

    it('should set the component name', () => {
      const logger = createLogger('my-component');
      // The logger should have bindings with the name
      expect((logger as any).bindings().name).toBe('my-component');
    });

    it('should default to info level', () => {
      delete process.env.LOG_LEVEL;
      const logger = createLogger('test');
      expect(logger.level).toBe('info');
    });

    it('should respect explicit level parameter', () => {
      const logger = createLogger('test', 'error');
      expect(logger.level).toBe('error');
    });

    it('should respect LOG_LEVEL env var when no explicit level given', async () => {
      process.env.LOG_LEVEL = 'debug';
      // Need to reimport to pick up env change
      const { createLogger: freshCreateLogger } = await import('../../../src/utils/logger');
      const logger = freshCreateLogger('test');
      expect(logger.level).toBe('debug');
    });

    it('should ignore invalid LOG_LEVEL values', async () => {
      process.env.LOG_LEVEL = 'invalid';
      const { createLogger: freshCreateLogger } = await import('../../../src/utils/logger');
      const logger = freshCreateLogger('test');
      expect(logger.level).toBe('info');
    });
  });

  describe('log levels', () => {
    it('should support trace level', () => {
      const logger = createLogger('test', 'trace');
      expect(logger.level).toBe('trace');
      expect(typeof logger.trace).toBe('function');
    });

    it('should support debug level', () => {
      const logger = createLogger('test', 'debug');
      expect(logger.level).toBe('debug');
      expect(typeof logger.debug).toBe('function');
    });

    it('should support info level', () => {
      const logger = createLogger('test', 'info');
      expect(logger.level).toBe('info');
      expect(typeof logger.info).toBe('function');
    });

    it('should support warn level', () => {
      const logger = createLogger('test', 'warn');
      expect(logger.level).toBe('warn');
      expect(typeof logger.warn).toBe('function');
    });

    it('should support error level', () => {
      const logger = createLogger('test', 'error');
      expect(logger.level).toBe('error');
      expect(typeof logger.error).toBe('function');
    });

    it('should support fatal level', () => {
      const logger = createLogger('test', 'fatal');
      expect(logger.level).toBe('fatal');
      expect(typeof logger.fatal).toBe('function');
    });
  });

  describe('createChildLogger', () => {
    it('should create a child logger with additional bindings', () => {
      const parent = createLogger('parent');
      const child = createChildLogger(parent, { requestId: '123' });

      expect(child).toBeDefined();
      expect((child as any).bindings().requestId).toBe('123');
      expect((child as any).bindings().name).toBe('parent');
    });

    it('should inherit log level from parent', () => {
      const parent = createLogger('parent', 'debug');
      const child = createChildLogger(parent, { component: 'child' });

      expect(child.level).toBe('debug');
    });
  });
});
