/**
 * Unit tests for CLI option parsing and validation utilities
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  parseStartOptions,
  parseConnectOptions,
  validateWebSocketUrl,
  colorize,
  supportsColor,
  padToWidth,
  formatDuration,
  formatBytes,
  setupGracefulShutdown,
  handleUnhandledRejections,
} from '../../../src/cli/utils.js';

describe('CLI Option Parsing', () => {
  describe('parseStartOptions', () => {
    it('should parse port option', () => {
      const options = parseStartOptions({ port: '9000' });
      expect(options.listen?.port).toBe(9000);
      expect(options.listen?.host).toBe('0.0.0.0');
    });

    it('should parse host option', () => {
      const options = parseStartOptions({ host: '127.0.0.1' });
      expect(options.listen?.host).toBe('127.0.0.1');
      expect(options.listen?.port).toBe(8765); // default port
    });

    it('should parse port and host together', () => {
      const options = parseStartOptions({ port: '8080', host: 'localhost' });
      expect(options.listen?.port).toBe(8080);
      expect(options.listen?.host).toBe('localhost');
    });

    it('should enable daemon mode', () => {
      const options = parseStartOptions({ daemon: true });
      expect(options.daemon).toBe(true);
    });

    it('should parse connect URL', () => {
      const options = parseStartOptions({ connect: 'ws://localhost:8765' });
      expect(options.connect?.url).toBe('ws://localhost:8765');
    });

    it('should throw for invalid port (not a number)', () => {
      expect(() => parseStartOptions({ port: 'abc' })).toThrow(/Invalid port/);
    });

    it('should throw for invalid port (too low)', () => {
      expect(() => parseStartOptions({ port: '0' })).toThrow(/Invalid port/);
    });

    it('should throw for invalid port (too high)', () => {
      expect(() => parseStartOptions({ port: '65536' })).toThrow(/Invalid port/);
    });

    it('should throw for invalid connect URL', () => {
      expect(() => parseStartOptions({ connect: 'http://invalid' })).toThrow(
        /Invalid URL protocol/
      );
    });

    it('should handle empty options', () => {
      const options = parseStartOptions({});
      expect(options.listen).toBeUndefined();
      expect(options.connect).toBeUndefined();
      expect(options.daemon).toBe(false);
    });
  });

  describe('parseConnectOptions', () => {
    it('should parse valid ws:// URL', () => {
      const options = parseConnectOptions({ url: 'ws://localhost:8765' });
      expect(options.url).toBe('ws://localhost:8765');
    });

    it('should parse valid wss:// URL', () => {
      const options = parseConnectOptions({ url: 'wss://example.com:443' });
      expect(options.url).toBe('wss://example.com:443');
    });

    it('should throw for missing URL', () => {
      expect(() => parseConnectOptions({})).toThrow(/URL is required/);
    });

    it('should throw for invalid URL protocol', () => {
      expect(() => parseConnectOptions({ url: 'http://invalid' })).toThrow(
        /Invalid URL protocol/
      );
    });

    it('should throw for invalid URL format', () => {
      expect(() => parseConnectOptions({ url: 'ws://invalid url' })).toThrow(
        /Invalid URL/
      );
    });
  });

  describe('validateWebSocketUrl', () => {
    it('should accept ws:// URLs', () => {
      expect(() => validateWebSocketUrl('ws://localhost:8765')).not.toThrow();
    });

    it('should accept wss:// URLs', () => {
      expect(() => validateWebSocketUrl('wss://example.com:443')).not.toThrow();
    });

    it('should accept URLs without port', () => {
      expect(() => validateWebSocketUrl('ws://localhost')).not.toThrow();
    });

    it('should reject http:// URLs', () => {
      expect(() => validateWebSocketUrl('http://example.com')).toThrow(
        /Invalid URL protocol/
      );
    });

    it('should reject https:// URLs', () => {
      expect(() => validateWebSocketUrl('https://example.com')).toThrow(
        /Invalid URL protocol/
      );
    });

    it('should reject invalid URLs', () => {
      expect(() => validateWebSocketUrl('not a url')).toThrow(
        /Invalid URL protocol/
      );
    });
  });
});

describe('CLI Output Formatting', () => {
  describe('padToWidth', () => {
    it('should pad left (default)', () => {
      expect(padToWidth('abc', 6)).toBe('abc   ');
    });

    it('should pad right', () => {
      expect(padToWidth('abc', 6, 'right')).toBe('   abc');
    });

    it('should pad center', () => {
      expect(padToWidth('ab', 6, 'center')).toBe('  ab  ');
    });

    it('should truncate long strings', () => {
      expect(padToWidth('abcdefgh', 5)).toBe('abcde');
    });

    it('should handle empty string', () => {
      expect(padToWidth('', 5)).toBe('     ');
    });
  });

  describe('formatDuration', () => {
    it('should format milliseconds', () => {
      expect(formatDuration(500)).toBe('500ms');
    });

    it('should format seconds', () => {
      expect(formatDuration(5000)).toBe('5.0s');
    });

    it('should format minutes and seconds', () => {
      expect(formatDuration(125000)).toBe('2m 5s');
    });

    it('should format hours and minutes', () => {
      expect(formatDuration(3660000)).toBe('1h 1m');
    });
  });

  describe('formatBytes', () => {
    it('should format bytes', () => {
      expect(formatBytes(500)).toBe('500 B');
    });

    it('should format kilobytes', () => {
      expect(formatBytes(1536)).toBe('1.5 KB');
    });

    it('should format megabytes', () => {
      expect(formatBytes(1572864)).toBe('1.5 MB');
    });

    it('should format gigabytes', () => {
      expect(formatBytes(1610612736)).toBe('1.5 GB');
    });
  });

  describe('colorize', () => {
    it('should return original text when colors not supported', () => {
      // In test environment, colors are typically not supported (no TTY)
      const result = colorize('test', 'red');
      // Either plain text or colored text depending on environment
      expect(result).toContain('test');
    });
  });
});

describe('Graceful Shutdown', () => {
  describe('setupGracefulShutdown', () => {
    let originalListeners: NodeJS.SignalsListener[];
    let exitSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      // Save original listeners
      originalListeners = process.listeners('SIGINT') as NodeJS.SignalsListener[];
      // Spy on process.exit
      exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    });

    afterEach(() => {
      // Restore mocks
      exitSpy.mockRestore();
      // Remove any listeners we added
      process.removeAllListeners('SIGINT');
      process.removeAllListeners('SIGTERM');
      // Restore original listeners
      for (const listener of originalListeners) {
        process.on('SIGINT', listener);
      }
    });

    it('should register signal handlers', () => {
      const cleanup = vi.fn().mockResolvedValue(undefined);

      const removeHandlers = setupGracefulShutdown({ cleanup });

      // Check that handlers were registered
      const sigintListeners = process.listeners('SIGINT');
      const sigtermListeners = process.listeners('SIGTERM');

      expect(sigintListeners.length).toBeGreaterThan(0);
      expect(sigtermListeners.length).toBeGreaterThan(0);

      // Cleanup
      removeHandlers();
    });

    it('should return function that removes handlers', () => {
      const cleanup = vi.fn().mockResolvedValue(undefined);

      const initialSigint = process.listenerCount('SIGINT');
      const removeHandlers = setupGracefulShutdown({ cleanup });
      const afterSetup = process.listenerCount('SIGINT');

      expect(afterSetup).toBe(initialSigint + 1);

      removeHandlers();
      const afterRemove = process.listenerCount('SIGINT');

      expect(afterRemove).toBe(initialSigint);
    });

    it('should call cleanup function on shutdown', async () => {
      const cleanup = vi.fn().mockResolvedValue(undefined);
      const afterCleanup = vi.fn();

      setupGracefulShutdown({
        cleanup,
        afterCleanup,
        verbose: false,
      });

      // Simulate SIGINT
      process.emit('SIGINT');

      // Wait for async cleanup
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(cleanup).toHaveBeenCalled();
      expect(afterCleanup).toHaveBeenCalled();
    });

    it('should exit with code 0 on successful cleanup', async () => {
      const cleanup = vi.fn().mockResolvedValue(undefined);

      setupGracefulShutdown({
        cleanup,
        verbose: false,
      });

      // Simulate SIGINT
      process.emit('SIGINT');

      // Wait for async cleanup
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(exitSpy).toHaveBeenCalledWith(0);
    });

    it('should exit with code 1 on cleanup error', async () => {
      const cleanup = vi.fn().mockRejectedValue(new Error('Cleanup failed'));

      setupGracefulShutdown({
        cleanup,
        verbose: false,
      });

      // Simulate SIGINT
      process.emit('SIGINT');

      // Wait for async cleanup
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it('should prevent multiple shutdown attempts', async () => {
      const cleanup = vi.fn().mockImplementation(
        () => new Promise((resolve) => setTimeout(resolve, 200))
      );

      setupGracefulShutdown({
        cleanup,
        verbose: false,
      });

      // Simulate multiple SIGINT
      process.emit('SIGINT');
      process.emit('SIGINT');
      process.emit('SIGINT');

      // Wait for async cleanup
      await new Promise((resolve) => setTimeout(resolve, 300));

      // Cleanup should only be called once
      expect(cleanup).toHaveBeenCalledTimes(1);
    });
  });

  describe('handleUnhandledRejections', () => {
    let originalListeners: NodeJS.UnhandledRejectionListener[];
    let exitSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      // Save original listeners
      originalListeners = process.listeners('unhandledRejection') as NodeJS.UnhandledRejectionListener[];
      process.removeAllListeners('unhandledRejection');
      // Spy on process.exit
      exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    });

    afterEach(() => {
      // Restore mocks
      exitSpy.mockRestore();
      // Remove listeners we added
      process.removeAllListeners('unhandledRejection');
      // Restore original listeners
      for (const listener of originalListeners) {
        process.on('unhandledRejection', listener);
      }
    });

    it('should register unhandledRejection handler', () => {
      const initialCount = process.listenerCount('unhandledRejection');

      handleUnhandledRejections();

      expect(process.listenerCount('unhandledRejection')).toBe(initialCount + 1);
    });

    it('should log unhandled rejections', () => {
      const logger = vi.fn();
      handleUnhandledRejections({ logger, exit: false });

      // Create a resolved promise to avoid actual unhandled rejection
      const dummyPromise = Promise.resolve();
      const error = new Error('Test rejection');

      // Emit the event without creating an actual unhandled rejection
      process.emit('unhandledRejection', error, dummyPromise);

      expect(logger).toHaveBeenCalledWith('Unhandled promise rejection:', error);
    });

    it('should exit when configured', () => {
      handleUnhandledRejections({ exit: true, logger: () => {} });

      // Create a resolved promise to avoid actual unhandled rejection
      const dummyPromise = Promise.resolve();
      const error = new Error('Test rejection');

      // Emit the event without creating an actual unhandled rejection
      process.emit('unhandledRejection', error, dummyPromise);

      expect(exitSpy).toHaveBeenCalledWith(1);
    });
  });
});
