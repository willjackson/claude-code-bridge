/**
 * Unit tests for Transport factory and exports
 */

import { describe, it, expect } from 'vitest';
import {
  createTransport,
  WebSocketTransport,
  ConnectionState,
  type Transport,
  type ConnectionConfig,
  type TransportType,
  type CreateTransportOptions,
} from '../../../src/transport/index.js';

describe('Transport Factory', () => {
  describe('createTransport', () => {
    it('should create WebSocket transport by default', () => {
      const transport = createTransport('websocket');
      expect(transport).toBeDefined();
      expect(transport).toBeInstanceOf(WebSocketTransport);
    });

    it('should create WebSocket transport with type websocket', () => {
      const transport = createTransport('websocket');
      expect(transport.connect).toBeDefined();
      expect(transport.disconnect).toBeDefined();
      expect(transport.send).toBeDefined();
      expect(transport.onMessage).toBeDefined();
      expect(transport.onDisconnect).toBeDefined();
      expect(transport.onError).toBeDefined();
      expect(transport.isConnected).toBeDefined();
      expect(transport.getState).toBeDefined();
    });

    it('should accept optional options parameter', () => {
      const options: CreateTransportOptions = {
        config: {
          url: 'ws://localhost:8765',
        },
      };
      const transport = createTransport('websocket', options);
      expect(transport).toBeInstanceOf(WebSocketTransport);
    });

    it('should throw for unknown transport type', () => {
      expect(() => createTransport('unknown' as TransportType)).toThrow(
        'Unknown transport type: unknown'
      );
    });

    it('should throw for invalid transport type', () => {
      expect(() => createTransport('tcp' as TransportType)).toThrow(
        'Unknown transport type: tcp'
      );
    });
  });

  describe('Transport interface exports', () => {
    it('should export ConnectionState enum', () => {
      expect(ConnectionState.DISCONNECTED).toBe('DISCONNECTED');
      expect(ConnectionState.CONNECTING).toBe('CONNECTING');
      expect(ConnectionState.CONNECTED).toBe('CONNECTED');
      expect(ConnectionState.RECONNECTING).toBe('RECONNECTING');
    });

    it('should export WebSocketTransport class', () => {
      expect(WebSocketTransport).toBeDefined();
      const transport = new WebSocketTransport();
      expect(transport).toBeInstanceOf(WebSocketTransport);
    });

    it('created transport should start in DISCONNECTED state', () => {
      const transport = createTransport('websocket');
      expect(transport.getState()).toBe(ConnectionState.DISCONNECTED);
      expect(transport.isConnected()).toBe(false);
    });
  });

  describe('Type exports', () => {
    it('should use Transport interface correctly', () => {
      const transport: Transport = createTransport('websocket');
      expect(transport.connect).toBeDefined();
    });

    it('should use ConnectionConfig type correctly', () => {
      const config: ConnectionConfig = {
        url: 'ws://localhost:8765',
        reconnect: true,
        reconnectInterval: 1000,
        maxReconnectAttempts: 5,
      };
      expect(config.url).toBe('ws://localhost:8765');
      expect(config.reconnect).toBe(true);
    });
  });
});
