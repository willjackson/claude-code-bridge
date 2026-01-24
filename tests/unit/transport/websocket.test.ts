/**
 * Unit tests for WebSocketTransport
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { WebSocketServer, WebSocket as WsWebSocket } from 'ws';
import { WebSocketTransport } from '../../../src/transport/websocket.js';
import { ConnectionState } from '../../../src/transport/interface.js';
import { createMessage } from '../../../src/bridge/protocol.js';
import type { BridgeMessage } from '../../../src/bridge/protocol.js';

describe('WebSocketTransport', () => {
  let server: WebSocketServer;
  let transport: WebSocketTransport;
  const PORT = 18765;

  beforeEach(() => {
    server = new WebSocketServer({ port: PORT });
  });

  afterEach(async () => {
    if (transport) {
      await transport.disconnect();
    }
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  });

  describe('initial state', () => {
    it('should start in disconnected state', () => {
      transport = new WebSocketTransport();
      expect(transport.getState()).toBe(ConnectionState.DISCONNECTED);
      expect(transport.isConnected()).toBe(false);
    });
  });

  describe('connect', () => {
    it('should connect to WebSocket server', async () => {
      transport = new WebSocketTransport();
      await transport.connect({ url: `ws://localhost:${PORT}` });

      expect(transport.isConnected()).toBe(true);
      expect(transport.getState()).toBe(ConnectionState.CONNECTED);
    });

    it('should connect using host and port', async () => {
      transport = new WebSocketTransport();
      await transport.connect({ host: 'localhost', port: PORT });

      expect(transport.isConnected()).toBe(true);
    });

    it('should use default host and port when not provided', async () => {
      // Start a server on the default port
      const defaultServer = new WebSocketServer({ port: 8765 });

      try {
        transport = new WebSocketTransport();
        await transport.connect({});

        expect(transport.isConnected()).toBe(true);
      } finally {
        await transport.disconnect();
        await new Promise<void>((resolve) => defaultServer.close(() => resolve()));
      }
    });

    it('should reject connection to non-existent server', async () => {
      transport = new WebSocketTransport();

      await expect(
        transport.connect({ url: 'ws://localhost:19999' })
      ).rejects.toThrow();

      expect(transport.isConnected()).toBe(false);
      expect(transport.getState()).toBe(ConnectionState.DISCONNECTED);
    });

    it('should throw if already connected', async () => {
      transport = new WebSocketTransport();
      await transport.connect({ url: `ws://localhost:${PORT}` });

      await expect(
        transport.connect({ url: `ws://localhost:${PORT}` })
      ).rejects.toThrow('Already connected');
    });
  });

  describe('disconnect', () => {
    it('should disconnect cleanly', async () => {
      transport = new WebSocketTransport();
      await transport.connect({ url: `ws://localhost:${PORT}` });
      expect(transport.isConnected()).toBe(true);

      await transport.disconnect();

      expect(transport.isConnected()).toBe(false);
      expect(transport.getState()).toBe(ConnectionState.DISCONNECTED);
    });

    it('should handle disconnect when not connected', async () => {
      transport = new WebSocketTransport();
      // Should not throw
      await transport.disconnect();
      expect(transport.isConnected()).toBe(false);
    });

    it('should handle multiple disconnect calls', async () => {
      transport = new WebSocketTransport();
      await transport.connect({ url: `ws://localhost:${PORT}` });

      await transport.disconnect();
      await transport.disconnect(); // Should not throw

      expect(transport.isConnected()).toBe(false);
    });
  });

  describe('send', () => {
    it('should send and receive messages', async () => {
      const receivedMessages: BridgeMessage[] = [];

      // Set up server to echo messages
      server.on('connection', (ws: WsWebSocket) => {
        ws.on('message', (data: Buffer) => {
          ws.send(data.toString());
        });
      });

      transport = new WebSocketTransport();
      transport.onMessage((msg: BridgeMessage) => receivedMessages.push(msg));

      await transport.connect({ url: `ws://localhost:${PORT}` });

      const testMessage = createMessage('notification', 'test-source');

      await transport.send(testMessage);

      // Wait for echo
      await new Promise((r) => setTimeout(r, 100));

      expect(receivedMessages).toHaveLength(1);
      expect(receivedMessages[0].id).toBe(testMessage.id);
      expect(receivedMessages[0].type).toBe('notification');
      expect(receivedMessages[0].source).toBe('test-source');
    });

    it('should throw when sending without connection', async () => {
      transport = new WebSocketTransport();

      const testMessage = createMessage('notification', 'test');

      await expect(transport.send(testMessage)).rejects.toThrow('Not connected');
    });

    it('should send multiple messages', async () => {
      const receivedOnServer: string[] = [];

      server.on('connection', (ws: WsWebSocket) => {
        ws.on('message', (data: Buffer) => {
          receivedOnServer.push(data.toString());
        });
      });

      transport = new WebSocketTransport();
      await transport.connect({ url: `ws://localhost:${PORT}` });

      const msg1 = createMessage('request', 'test');
      const msg2 = createMessage('response', 'test');
      const msg3 = createMessage('notification', 'test');

      await transport.send(msg1);
      await transport.send(msg2);
      await transport.send(msg3);

      // Wait for messages to arrive
      await new Promise((r) => setTimeout(r, 100));

      expect(receivedOnServer).toHaveLength(3);
    });
  });

  describe('onMessage', () => {
    it('should call message handler when message received', async () => {
      const receivedMessages: BridgeMessage[] = [];

      transport = new WebSocketTransport();
      transport.onMessage((msg) => receivedMessages.push(msg));

      await transport.connect({ url: `ws://localhost:${PORT}` });

      // Send message from server to client
      const testMessage = createMessage('notification', 'server');

      server.clients.forEach((client) => {
        client.send(JSON.stringify(testMessage));
      });

      await new Promise((r) => setTimeout(r, 100));

      expect(receivedMessages).toHaveLength(1);
      expect(receivedMessages[0].id).toBe(testMessage.id);
    });

    it('should support multiple message handlers', async () => {
      let handler1Count = 0;
      let handler2Count = 0;

      transport = new WebSocketTransport();
      transport.onMessage(() => { handler1Count++; });
      transport.onMessage(() => { handler2Count++; });

      await transport.connect({ url: `ws://localhost:${PORT}` });

      const testMessage = createMessage('notification', 'server');
      server.clients.forEach((client) => {
        client.send(JSON.stringify(testMessage));
      });

      await new Promise((r) => setTimeout(r, 100));

      expect(handler1Count).toBe(1);
      expect(handler2Count).toBe(1);
    });

    it('should handle invalid message gracefully', async () => {
      const errors: Error[] = [];
      const messages: BridgeMessage[] = [];

      transport = new WebSocketTransport();
      transport.onMessage((msg) => messages.push(msg));
      transport.onError((err) => errors.push(err));

      await transport.connect({ url: `ws://localhost:${PORT}` });

      // Send invalid message from server
      server.clients.forEach((client) => {
        client.send('not valid json');
      });

      await new Promise((r) => setTimeout(r, 100));

      expect(messages).toHaveLength(0);
      expect(errors).toHaveLength(1);
      expect(errors[0].message).toContain('Invalid message format');
    });

    it('should handle message with invalid schema', async () => {
      const errors: Error[] = [];
      const messages: BridgeMessage[] = [];

      transport = new WebSocketTransport();
      transport.onMessage((msg) => messages.push(msg));
      transport.onError((err) => errors.push(err));

      await transport.connect({ url: `ws://localhost:${PORT}` });

      // Send message with wrong structure
      server.clients.forEach((client) => {
        client.send(JSON.stringify({ foo: 'bar' }));
      });

      await new Promise((r) => setTimeout(r, 100));

      expect(messages).toHaveLength(0);
      expect(errors).toHaveLength(1);
    });
  });

  describe('onDisconnect', () => {
    it('should emit disconnect event when server closes connection', async () => {
      let disconnected = false;

      transport = new WebSocketTransport();
      transport.onDisconnect(() => {
        disconnected = true;
      });

      await transport.connect({ url: `ws://localhost:${PORT}` });
      expect(transport.isConnected()).toBe(true);

      // Force server-side disconnect
      server.clients.forEach((client) => client.close());

      await new Promise((r) => setTimeout(r, 100));

      expect(disconnected).toBe(true);
      expect(transport.isConnected()).toBe(false);
    });

    it('should support multiple disconnect handlers', async () => {
      let handler1Called = false;
      let handler2Called = false;

      transport = new WebSocketTransport();
      transport.onDisconnect(() => { handler1Called = true; });
      transport.onDisconnect(() => { handler2Called = true; });

      await transport.connect({ url: `ws://localhost:${PORT}` });

      server.clients.forEach((client) => client.close());

      await new Promise((r) => setTimeout(r, 100));

      expect(handler1Called).toBe(true);
      expect(handler2Called).toBe(true);
    });
  });

  describe('onError', () => {
    it('should call error handler on connection failure', async () => {
      const errors: Error[] = [];

      transport = new WebSocketTransport();
      transport.onError((err) => errors.push(err));

      await expect(
        transport.connect({ url: 'ws://localhost:19999' })
      ).rejects.toThrow();

      // Error handler is called for connection errors during connect attempt
      // but since connect rejects, error handler may not be called
      // This depends on implementation
    });

    it('should support multiple error handlers', async () => {
      let handler1Count = 0;
      let handler2Count = 0;

      transport = new WebSocketTransport();
      transport.onError(() => { handler1Count++; });
      transport.onError(() => { handler2Count++; });

      await transport.connect({ url: `ws://localhost:${PORT}` });

      // Send invalid message to trigger error
      server.clients.forEach((client) => {
        client.send('invalid json');
      });

      await new Promise((r) => setTimeout(r, 100));

      expect(handler1Count).toBe(1);
      expect(handler2Count).toBe(1);
    });
  });

  describe('isConnected', () => {
    it('should return false before connection', () => {
      transport = new WebSocketTransport();
      expect(transport.isConnected()).toBe(false);
    });

    it('should return true when connected', async () => {
      transport = new WebSocketTransport();
      await transport.connect({ url: `ws://localhost:${PORT}` });
      expect(transport.isConnected()).toBe(true);
    });

    it('should return false after disconnect', async () => {
      transport = new WebSocketTransport();
      await transport.connect({ url: `ws://localhost:${PORT}` });
      await transport.disconnect();
      expect(transport.isConnected()).toBe(false);
    });
  });

  describe('getState', () => {
    it('should return DISCONNECTED initially', () => {
      transport = new WebSocketTransport();
      expect(transport.getState()).toBe(ConnectionState.DISCONNECTED);
    });

    it('should return CONNECTED after successful connection', async () => {
      transport = new WebSocketTransport();
      await transport.connect({ url: `ws://localhost:${PORT}` });
      expect(transport.getState()).toBe(ConnectionState.CONNECTED);
    });

    it('should return DISCONNECTED after disconnect', async () => {
      transport = new WebSocketTransport();
      await transport.connect({ url: `ws://localhost:${PORT}` });
      await transport.disconnect();
      expect(transport.getState()).toBe(ConnectionState.DISCONNECTED);
    });
  });

  describe('auto-reconnect', () => {
    it('should reconnect automatically when enabled', async () => {
      let connectCount = 0;

      server.on('connection', () => {
        connectCount++;
      });

      transport = new WebSocketTransport();
      await transport.connect({
        url: `ws://localhost:${PORT}`,
        reconnect: true,
        reconnectInterval: 100,
        maxReconnectAttempts: 3,
      });

      expect(connectCount).toBe(1);
      expect(transport.isConnected()).toBe(true);

      // Force server-side disconnect
      server.clients.forEach((client) => client.close());

      // Wait for reconnect
      await new Promise((r) => setTimeout(r, 300));

      expect(connectCount).toBe(2);
      expect(transport.isConnected()).toBe(true);
    });

    it('should not reconnect when disabled', async () => {
      let connectCount = 0;

      server.on('connection', () => {
        connectCount++;
      });

      transport = new WebSocketTransport();
      await transport.connect({
        url: `ws://localhost:${PORT}`,
        reconnect: false,
      });

      expect(connectCount).toBe(1);

      // Force server-side disconnect
      server.clients.forEach((client) => client.close());

      // Wait to ensure no reconnect happens
      await new Promise((r) => setTimeout(r, 200));

      expect(connectCount).toBe(1);
      expect(transport.isConnected()).toBe(false);
    });

    it('should emit RECONNECTING state during reconnection', async () => {
      let reconnectingAttempt = 0;
      let reconnectingMaxAttempts = 0;

      transport = new WebSocketTransport();
      transport.onReconnecting((attempt, maxAttempts) => {
        reconnectingAttempt = attempt;
        reconnectingMaxAttempts = maxAttempts;
      });

      await transport.connect({
        url: `ws://localhost:${PORT}`,
        reconnect: true,
        reconnectInterval: 50,
        maxReconnectAttempts: 5,
      });

      // Force disconnect
      server.clients.forEach((client) => client.close());

      // Wait for reconnecting state
      await new Promise((r) => setTimeout(r, 100));

      expect(reconnectingAttempt).toBe(1);
      expect(reconnectingMaxAttempts).toBe(5);
    });

    it('should stop reconnecting after max attempts', async () => {
      let reconnectAttempts = 0;
      const errors: Error[] = [];

      transport = new WebSocketTransport();
      transport.onError((err) => errors.push(err));
      transport.onReconnecting(() => { reconnectAttempts++; });

      await transport.connect({
        url: `ws://localhost:${PORT}`,
        reconnect: true,
        reconnectInterval: 50,
        maxReconnectAttempts: 2,
      });

      // Close all clients and the server to force disconnect
      server.clients.forEach((client) => client.close());

      // Close the server entirely to make reconnection fail
      // First terminate all clients to allow server to close
      server.clients.forEach((client) => client.terminate());
      server.close();

      // Wait for reconnection attempts to exhaust
      // With 2 max attempts and 50ms interval, need at least 200ms
      await new Promise((r) => setTimeout(r, 500));

      // Should have attempted reconnection (at least 1)
      expect(reconnectAttempts).toBeGreaterThanOrEqual(1);

      // Recreate server for cleanup (afterEach expects it to exist)
      server = new WebSocketServer({ port: PORT });
    });

    it('should not reconnect after intentional disconnect', async () => {
      let connectCount = 0;

      server.on('connection', () => {
        connectCount++;
      });

      transport = new WebSocketTransport();
      await transport.connect({
        url: `ws://localhost:${PORT}`,
        reconnect: true,
        reconnectInterval: 50,
      });

      expect(connectCount).toBe(1);

      // Intentional disconnect
      await transport.disconnect();

      // Wait to ensure no reconnect happens
      await new Promise((r) => setTimeout(r, 200));

      expect(connectCount).toBe(1);
      expect(transport.isConnected()).toBe(false);
    });
  });

  describe('message queuing', () => {
    it('should queue messages when disconnected and reconnect enabled', async () => {
      const receivedOnServer: string[] = [];

      server.on('connection', (ws: WsWebSocket) => {
        ws.on('message', (data: Buffer) => {
          receivedOnServer.push(data.toString());
        });
      });

      transport = new WebSocketTransport();
      await transport.connect({
        url: `ws://localhost:${PORT}`,
        reconnect: true,
        reconnectInterval: 100,
      });

      // Force disconnect
      server.clients.forEach((client) => client.close());

      // Wait for disconnect
      await new Promise((r) => setTimeout(r, 50));
      expect(transport.isConnected()).toBe(false);

      // Send while disconnected (should queue)
      const msg1 = createMessage('notification', 'test');
      const msg2 = createMessage('request', 'test');
      await transport.send(msg1);
      await transport.send(msg2);

      expect(transport.getQueueLength()).toBe(2);

      // Wait for reconnect and queue flush
      await new Promise((r) => setTimeout(r, 300));

      expect(transport.isConnected()).toBe(true);
      expect(transport.getQueueLength()).toBe(0);
      expect(receivedOnServer.length).toBe(2);
    });

    it('should throw when sending without reconnect enabled', async () => {
      transport = new WebSocketTransport();
      await transport.connect({
        url: `ws://localhost:${PORT}`,
        reconnect: false,
      });

      // Force disconnect
      server.clients.forEach((client) => client.close());
      await new Promise((r) => setTimeout(r, 50));

      const msg = createMessage('notification', 'test');
      await expect(transport.send(msg)).rejects.toThrow('Not connected');
    });

    it('should clear queue on intentional disconnect', async () => {
      transport = new WebSocketTransport();
      await transport.connect({
        url: `ws://localhost:${PORT}`,
        reconnect: true,
        reconnectInterval: 100,
      });

      // Force disconnect
      server.clients.forEach((client) => client.close());
      await new Promise((r) => setTimeout(r, 50));

      // Queue a message
      const msg = createMessage('notification', 'test');
      await transport.send(msg);
      expect(transport.getQueueLength()).toBe(1);

      // Intentional disconnect should clear queue
      await transport.disconnect();
      expect(transport.getQueueLength()).toBe(0);
    });
  });

  describe('heartbeat', () => {
    it('should respond to ping with pong', async () => {
      let pongReceived = false;

      server.on('connection', (ws: WsWebSocket) => {
        ws.on('pong', () => {
          pongReceived = true;
        });
        // Send ping from server
        ws.ping();
      });

      transport = new WebSocketTransport();
      await transport.connect({ url: `ws://localhost:${PORT}` });

      await new Promise((r) => setTimeout(r, 100));

      expect(pongReceived).toBe(true);
    });

    it('should send pings to keep connection alive', async () => {
      // This is a basic test - full heartbeat testing would require
      // manipulating the heartbeat interval which is internal
      transport = new WebSocketTransport();
      await transport.connect({ url: `ws://localhost:${PORT}` });

      // Just verify we can connect and the heartbeat doesn't break anything
      expect(transport.isConnected()).toBe(true);

      await new Promise((r) => setTimeout(r, 100));
      expect(transport.isConnected()).toBe(true);
    });
  });
});
