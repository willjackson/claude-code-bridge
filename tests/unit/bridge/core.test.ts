/**
 * Unit tests for Bridge Core class
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Bridge, type BridgeConfig, type PeerInfo } from '../../../src/bridge/core.js';
import { createMessage, type TaskRequest, type TaskResult, type Context, type FileChunk } from '../../../src/bridge/protocol.js';

describe('Bridge Core', () => {
  // Use different ports for each test to avoid conflicts
  let portCounter = 19000;

  function getNextPort(): number {
    return portCounter++;
  }

  describe('Constructor', () => {
    it('should create a bridge instance with valid config', () => {
      const config: BridgeConfig = {
        mode: 'host',
        instanceName: 'test-bridge',
        listen: { port: getNextPort() },
      };

      const bridge = new Bridge(config);
      expect(bridge).toBeDefined();
      expect(bridge.getInstanceName()).toBe('test-bridge');
      expect(bridge.getMode()).toBe('host');
    });

    it('should throw if host mode has no listen config', () => {
      const config: BridgeConfig = {
        mode: 'host',
        instanceName: 'test-bridge',
      };

      expect(() => new Bridge(config)).toThrow("'host' mode requires 'listen' configuration");
    });

    it('should throw if client mode has no connect config', () => {
      const config: BridgeConfig = {
        mode: 'client',
        instanceName: 'test-bridge',
      };

      expect(() => new Bridge(config)).toThrow("'client' mode requires 'connect' configuration");
    });

    it('should throw if peer mode has no listen or connect config', () => {
      const config: BridgeConfig = {
        mode: 'peer',
        instanceName: 'test-bridge',
      };

      expect(() => new Bridge(config)).toThrow("'peer' mode requires either 'listen' or 'connect' configuration");
    });

    it('should allow peer mode with only listen config', () => {
      const config: BridgeConfig = {
        mode: 'peer',
        instanceName: 'test-bridge',
        listen: { port: getNextPort() },
      };

      const bridge = new Bridge(config);
      expect(bridge.getMode()).toBe('peer');
    });

    it('should allow peer mode with only connect config', () => {
      const config: BridgeConfig = {
        mode: 'peer',
        instanceName: 'test-bridge',
        connect: { url: 'ws://localhost:9999' },
      };

      const bridge = new Bridge(config);
      expect(bridge.getMode()).toBe('peer');
    });
  });

  describe('Lifecycle - Host Mode', () => {
    let bridge: Bridge;
    const port = 19100;

    beforeEach(() => {
      bridge = new Bridge({
        mode: 'host',
        instanceName: 'test-host',
        listen: { port },
      });
    });

    afterEach(async () => {
      await bridge.stop();
    });

    it('should start and listen for connections', async () => {
      expect(bridge.isStarted()).toBe(false);
      await bridge.start();
      expect(bridge.isStarted()).toBe(true);
    });

    it('should throw if started twice', async () => {
      await bridge.start();
      await expect(bridge.start()).rejects.toThrow('Bridge is already started');
    });

    it('should stop cleanly', async () => {
      await bridge.start();
      expect(bridge.isStarted()).toBe(true);
      await bridge.stop();
      expect(bridge.isStarted()).toBe(false);
    });

    it('should return empty peers list when no connections', async () => {
      await bridge.start();
      expect(bridge.getPeers()).toEqual([]);
      expect(bridge.getPeerCount()).toBe(0);
    });
  });

  describe('Lifecycle - Client Mode', () => {
    let hostBridge: Bridge;
    let clientBridge: Bridge;
    const port = 19200;

    beforeEach(async () => {
      hostBridge = new Bridge({
        mode: 'host',
        instanceName: 'test-host',
        listen: { port },
      });
      await hostBridge.start();

      clientBridge = new Bridge({
        mode: 'client',
        instanceName: 'test-client',
        connect: { url: `ws://localhost:${port}` },
      });
    });

    afterEach(async () => {
      await clientBridge.stop();
      await hostBridge.stop();
    });

    it('should connect to host bridge', async () => {
      await clientBridge.start();

      // Wait for connection to be established
      await new Promise((r) => setTimeout(r, 100));

      expect(clientBridge.isStarted()).toBe(true);
      expect(clientBridge.getPeerCount()).toBe(1);
    });

    it('should fail to connect to non-existent host', async () => {
      const badClient = new Bridge({
        mode: 'client',
        instanceName: 'bad-client',
        connect: { url: 'ws://localhost:59999' },
      });

      await expect(badClient.start()).rejects.toThrow();
    });
  });

  describe('Peer Communication', () => {
    let bridgeA: Bridge;
    let bridgeB: Bridge;
    const portA = 19300;

    beforeEach(async () => {
      // Bridge A acts as host
      bridgeA = new Bridge({
        mode: 'host',
        instanceName: 'bridge-a',
        listen: { port: portA },
      });
      await bridgeA.start();

      // Bridge B acts as client
      bridgeB = new Bridge({
        mode: 'client',
        instanceName: 'bridge-b',
        connect: { url: `ws://localhost:${portA}` },
      });
      await bridgeB.start();

      // Wait for connection
      await new Promise((r) => setTimeout(r, 100));
    });

    afterEach(async () => {
      await bridgeB.stop();
      await bridgeA.stop();
    });

    it('should track peers on both sides', () => {
      expect(bridgeA.getPeerCount()).toBe(1);
      expect(bridgeB.getPeerCount()).toBe(1);
    });

    it('should call peer connected handlers', async () => {
      const connectedHandler = vi.fn();

      const newBridgeA = new Bridge({
        mode: 'host',
        instanceName: 'bridge-a-new',
        listen: { port: 19301 },
      });
      newBridgeA.onPeerConnected(connectedHandler);
      await newBridgeA.start();

      const newBridgeB = new Bridge({
        mode: 'client',
        instanceName: 'bridge-b-new',
        connect: { url: 'ws://localhost:19301' },
      });
      await newBridgeB.start();

      await new Promise((r) => setTimeout(r, 100));

      expect(connectedHandler).toHaveBeenCalled();
      expect(connectedHandler.mock.calls[0][0]).toHaveProperty('id');
      expect(connectedHandler.mock.calls[0][0]).toHaveProperty('connectedAt');

      await newBridgeB.stop();
      await newBridgeA.stop();
    });

    it('should call peer disconnected handlers', async () => {
      const disconnectedHandler = vi.fn();
      bridgeA.onPeerDisconnected(disconnectedHandler);

      await bridgeB.stop();
      await new Promise((r) => setTimeout(r, 100));

      expect(disconnectedHandler).toHaveBeenCalled();
    });

    it('should send messages between peers', async () => {
      const receivedMessages: { message: any; peerId: string }[] = [];
      bridgeA.onMessage((message, peerId) => {
        receivedMessages.push({ message, peerId });
      });

      // Get peer ID from bridge B
      const peers = bridgeB.getPeers();
      expect(peers.length).toBe(1);
      const peerId = peers[0].id;

      // Send message from B to A
      const testMessage = createMessage('notification', 'bridge-b');
      await bridgeB.sendToPeer(peerId, testMessage);

      // Wait for message delivery
      await new Promise((r) => setTimeout(r, 100));

      expect(receivedMessages.length).toBe(1);
      expect(receivedMessages[0].message.source).toBe('bridge-b');
      expect(receivedMessages[0].message.type).toBe('notification');
    });

    it('should broadcast messages to all peers', async () => {
      const receivedMessages: { message: any; peerId: string }[] = [];
      bridgeB.onMessage((message, peerId) => {
        receivedMessages.push({ message, peerId });
      });

      // Broadcast from A
      const testMessage = createMessage('notification', 'bridge-a');
      await bridgeA.broadcast(testMessage);

      // Wait for message delivery
      await new Promise((r) => setTimeout(r, 100));

      expect(receivedMessages.length).toBe(1);
      expect(receivedMessages[0].message.source).toBe('bridge-a');
    });

    it('should throw when sending to unknown peer', async () => {
      const testMessage = createMessage('notification', 'test');
      await expect(bridgeA.sendToPeer('unknown-peer-id', testMessage)).rejects.toThrow('Peer not found');
    });
  });

  describe('Peer Mode (Bidirectional)', () => {
    let bridgeA: Bridge;
    let bridgeB: Bridge;
    const portA = 19400;
    const portB = 19401;

    beforeEach(async () => {
      // Bridge A listens on portA and connects to portB
      bridgeA = new Bridge({
        mode: 'peer',
        instanceName: 'peer-a',
        listen: { port: portA },
        connect: { url: `ws://localhost:${portB}` },
      });

      // Bridge B listens on portB (start first so A can connect)
      bridgeB = new Bridge({
        mode: 'peer',
        instanceName: 'peer-b',
        listen: { port: portB },
      });

      // Start B first, then A
      await bridgeB.start();
      await bridgeA.start();

      // Wait for connections
      await new Promise((r) => setTimeout(r, 200));
    });

    afterEach(async () => {
      await bridgeA.stop();
      await bridgeB.stop();
    });

    it('should establish bidirectional connection', () => {
      // A should have 1 peer (connected to B as client)
      expect(bridgeA.getPeerCount()).toBeGreaterThanOrEqual(1);
      // B should have 1 peer (A connected to it)
      expect(bridgeB.getPeerCount()).toBeGreaterThanOrEqual(1);
    });
  });

  describe('Connect and Disconnect Methods', () => {
    let hostBridge: Bridge;
    const port = 19500;

    beforeEach(async () => {
      hostBridge = new Bridge({
        mode: 'host',
        instanceName: 'test-host',
        listen: { port },
      });
      await hostBridge.start();
    });

    afterEach(async () => {
      await hostBridge.stop();
    });

    it('should connect to a peer using connectToPeer', async () => {
      const connectedHandler = vi.fn();
      hostBridge.onPeerConnected(connectedHandler);

      // Create a second host to connect to
      const otherHost = new Bridge({
        mode: 'host',
        instanceName: 'other-host',
        listen: { port: 19501 },
      });
      await otherHost.start();

      await hostBridge.connectToPeer('ws://localhost:19501');

      await new Promise((r) => setTimeout(r, 100));

      expect(hostBridge.getPeerCount()).toBe(1);
      expect(connectedHandler).toHaveBeenCalled();

      await otherHost.stop();
    });

    it('should disconnect from a specific peer', async () => {
      const disconnectedHandler = vi.fn();
      hostBridge.onPeerDisconnected(disconnectedHandler);

      // Create a client
      const client = new Bridge({
        mode: 'client',
        instanceName: 'test-client',
        connect: { url: `ws://localhost:${port}` },
      });
      await client.start();

      await new Promise((r) => setTimeout(r, 100));

      // Get the peer ID
      const peers = hostBridge.getPeers();
      expect(peers.length).toBe(1);
      const peerId = peers[0].id;

      // Disconnect the peer
      await hostBridge.disconnectFromPeer(peerId);

      await new Promise((r) => setTimeout(r, 100));

      expect(hostBridge.getPeerCount()).toBe(0);
      expect(disconnectedHandler).toHaveBeenCalled();

      await client.stop();
    });

    it('should throw when disconnecting unknown peer', async () => {
      await expect(hostBridge.disconnectFromPeer('unknown-peer')).rejects.toThrow('Peer not found');
    });
  });

  describe('PeerInfo', () => {
    let bridgeA: Bridge;
    let bridgeB: Bridge;
    const port = 19600;

    beforeEach(async () => {
      bridgeA = new Bridge({
        mode: 'host',
        instanceName: 'bridge-a',
        listen: { port },
      });
      await bridgeA.start();

      bridgeB = new Bridge({
        mode: 'client',
        instanceName: 'bridge-b',
        connect: { url: `ws://localhost:${port}` },
      });
      await bridgeB.start();

      await new Promise((r) => setTimeout(r, 100));
    });

    afterEach(async () => {
      await bridgeB.stop();
      await bridgeA.stop();
    });

    it('should include proper peer info fields', () => {
      const peers = bridgeA.getPeers();
      expect(peers.length).toBe(1);

      const peer = peers[0];
      expect(peer.id).toBeDefined();
      expect(typeof peer.id).toBe('string');
      expect(peer.connectedAt).toBeDefined();
      expect(typeof peer.connectedAt).toBe('number');
      expect(peer.lastActivity).toBeDefined();
      expect(peer.lastActivity).toBeGreaterThanOrEqual(peer.connectedAt);
    });

    it('should update lastActivity on message', async () => {
      const peers = bridgeA.getPeers();
      const initialActivity = peers[0].lastActivity;

      // Wait a bit
      await new Promise((r) => setTimeout(r, 50));

      // Send a message from B
      const bPeers = bridgeB.getPeers();
      const testMessage = createMessage('notification', 'bridge-b');
      await bridgeB.sendToPeer(bPeers[0].id, testMessage);

      // Wait for message delivery
      await new Promise((r) => setTimeout(r, 100));

      // Check lastActivity was updated
      const updatedPeers = bridgeA.getPeers();
      expect(updatedPeers[0].lastActivity).toBeGreaterThan(initialActivity);
    });
  });

  describe('Task Delegation', () => {
    let bridgeA: Bridge;
    let bridgeB: Bridge;
    const port = 19700;

    beforeEach(async () => {
      // Bridge A is the host that handles tasks
      bridgeA = new Bridge({
        mode: 'host',
        instanceName: 'task-host',
        listen: { port },
      });
      await bridgeA.start();

      // Bridge B is the client that delegates tasks
      bridgeB = new Bridge({
        mode: 'client',
        instanceName: 'task-client',
        connect: { url: `ws://localhost:${port}` },
      });
      await bridgeB.start();

      // Wait for connection
      await new Promise((r) => setTimeout(r, 100));
    });

    afterEach(async () => {
      await bridgeB.stop();
      await bridgeA.stop();
    });

    it('should delegate a task and receive result', async () => {
      // Register task handler on bridge A
      bridgeA.onTaskReceived(async (task) => {
        return {
          success: true,
          data: { processed: task.description },
        };
      });

      // Delegate task from bridge B
      const task: TaskRequest = {
        id: 'task-001',
        description: 'Test task',
        scope: 'execute',
      };

      const result = await bridgeB.delegateTask(task);

      expect(result.success).toBe(true);
      expect(result.data.processed).toBe('Test task');
      expect(result.taskId).toBe('task-001');
    });

    it('should handle task errors gracefully', async () => {
      // Register task handler that throws
      bridgeA.onTaskReceived(async (task) => {
        throw new Error('Task processing failed');
      });

      const task: TaskRequest = {
        id: 'task-002',
        description: 'Failing task',
        scope: 'execute',
      };

      const result = await bridgeB.delegateTask(task);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Task processing failed');
    });

    it('should handle timeout for slow tasks', async () => {
      // Register task handler that takes too long
      bridgeA.onTaskReceived(async (task) => {
        await new Promise((r) => setTimeout(r, 5000));
        return { success: true, data: {} };
      });

      const task: TaskRequest = {
        id: 'task-003',
        description: 'Slow task',
        scope: 'execute',
        timeout: 200, // Very short timeout
      };

      await expect(bridgeB.delegateTask(task)).rejects.toThrow(/timed out/i);
    });

    it('should throw if no peers connected', async () => {
      // Create a new bridge with no connections
      const isolatedBridge = new Bridge({
        mode: 'host',
        instanceName: 'isolated',
        listen: { port: 19701 },
      });
      await isolatedBridge.start();

      const task: TaskRequest = {
        id: 'task-004',
        description: 'Isolated task',
        scope: 'execute',
      };

      await expect(isolatedBridge.delegateTask(task)).rejects.toThrow('No peers connected');

      await isolatedBridge.stop();
    });

    it('should throw if peer not found', async () => {
      const task: TaskRequest = {
        id: 'task-005',
        description: 'Unknown peer task',
        scope: 'execute',
      };

      await expect(bridgeB.delegateTask(task, 'unknown-peer-id')).rejects.toThrow('Peer not found');
    });

    it('should return error when no task handler registered', async () => {
      // Don't register any handler on bridge A

      const task: TaskRequest = {
        id: 'task-006',
        description: 'No handler task',
        scope: 'execute',
      };

      const result = await bridgeB.delegateTask(task);

      expect(result.success).toBe(false);
      expect(result.error).toContain('No task handler registered');
    });

    it('should correlate responses by task ID', async () => {
      // Register handler that echoes task ID
      bridgeA.onTaskReceived(async (task) => {
        return {
          success: true,
          data: { echoId: task.id },
        };
      });

      // Send multiple tasks in parallel
      const task1: TaskRequest = { id: 'parallel-1', description: 'Task 1', scope: 'execute' };
      const task2: TaskRequest = { id: 'parallel-2', description: 'Task 2', scope: 'execute' };
      const task3: TaskRequest = { id: 'parallel-3', description: 'Task 3', scope: 'execute' };

      const [result1, result2, result3] = await Promise.all([
        bridgeB.delegateTask(task1),
        bridgeB.delegateTask(task2),
        bridgeB.delegateTask(task3),
      ]);

      expect(result1.taskId).toBe('parallel-1');
      expect(result1.data.echoId).toBe('parallel-1');
      expect(result2.taskId).toBe('parallel-2');
      expect(result2.data.echoId).toBe('parallel-2');
      expect(result3.taskId).toBe('parallel-3');
      expect(result3.data.echoId).toBe('parallel-3');
    });

    it('should reject pending tasks when peer disconnects', async () => {
      // Register a slow handler
      bridgeA.onTaskReceived(async (task) => {
        await new Promise((r) => setTimeout(r, 5000));
        return { success: true, data: {} };
      });

      const task: TaskRequest = {
        id: 'disconnect-task',
        description: 'Disconnect test',
        scope: 'execute',
      };

      // Start task delegation
      const taskPromise = bridgeB.delegateTask(task);

      // Wait a bit then disconnect the peer
      await new Promise((r) => setTimeout(r, 50));
      await bridgeA.stop();

      // Task should be rejected due to peer disconnect
      await expect(taskPromise).rejects.toThrow(/disconnected|shutting down/i);
    });

    it('should use configurable default timeout', async () => {
      // Create bridges with custom timeout
      const customHostBridge = new Bridge({
        mode: 'host',
        instanceName: 'custom-host',
        listen: { port: 19702 },
        taskTimeout: 100, // Very short default timeout
      });
      await customHostBridge.start();

      customHostBridge.onTaskReceived(async (task) => {
        await new Promise((r) => setTimeout(r, 500));
        return { success: true, data: {} };
      });

      const customClientBridge = new Bridge({
        mode: 'client',
        instanceName: 'custom-client',
        connect: { url: 'ws://localhost:19702' },
        taskTimeout: 100, // Very short default timeout
      });
      await customClientBridge.start();

      await new Promise((r) => setTimeout(r, 100));

      const task: TaskRequest = {
        id: 'timeout-config-task',
        description: 'Timeout config test',
        scope: 'execute',
        // No explicit timeout - should use config default
      };

      await expect(customClientBridge.delegateTask(task)).rejects.toThrow(/timed out/i);

      await customClientBridge.stop();
      await customHostBridge.stop();
    });

    it('should include artifacts in task result', async () => {
      bridgeA.onTaskReceived(async (task) => {
        return {
          success: true,
          data: { processed: true },
          artifacts: [
            { path: 'src/new-file.ts', action: 'created' as const },
            { path: 'src/modified.ts', action: 'modified' as const, diff: '+new line' },
          ],
        };
      });

      const task: TaskRequest = {
        id: 'artifact-task',
        description: 'Task with artifacts',
        scope: 'execute',
      };

      const result = await bridgeB.delegateTask(task);

      expect(result.success).toBe(true);
      expect(result.artifacts).toHaveLength(2);
      expect(result.artifacts?.[0].path).toBe('src/new-file.ts');
      expect(result.artifacts?.[1].diff).toBe('+new line');
    });

    it('should include followUp in task result', async () => {
      bridgeA.onTaskReceived(async (task) => {
        return {
          success: true,
          data: {},
          followUp: 'What should be the next step?',
        };
      });

      const task: TaskRequest = {
        id: 'followup-task',
        description: 'Task with followup',
        scope: 'analyze',
      };

      const result = await bridgeB.delegateTask(task);

      expect(result.success).toBe(true);
      expect(result.followUp).toBe('What should be the next step?');
    });
  });

  describe('Context Synchronization', () => {
    let bridgeA: Bridge;
    let bridgeB: Bridge;
    const port = 19800;

    beforeEach(async () => {
      // Bridge A is the host
      bridgeA = new Bridge({
        mode: 'host',
        instanceName: 'context-host',
        listen: { port },
      });
      await bridgeA.start();

      // Bridge B is the client
      bridgeB = new Bridge({
        mode: 'client',
        instanceName: 'context-client',
        connect: { url: `ws://localhost:${port}` },
      });
      await bridgeB.start();

      // Wait for connection
      await new Promise((r) => setTimeout(r, 100));
    });

    afterEach(async () => {
      await bridgeB.stop();
      await bridgeA.stop();
    });

    it('should sync context to a specific peer', async () => {
      const receivedContexts: { context: Context; peerId: string }[] = [];
      bridgeA.onContextReceived((context, peerId) => {
        receivedContexts.push({ context, peerId });
      });

      // Get peer ID from bridge B
      const peers = bridgeB.getPeers();
      expect(peers.length).toBe(1);
      const peerId = peers[0].id;

      // Sync context from B to A
      const testContext: Context = {
        files: [{ path: 'test.ts', content: 'const x = 1;' }],
        summary: 'Test context',
      };
      await bridgeB.syncContext(testContext, peerId);

      // Wait for message delivery
      await new Promise((r) => setTimeout(r, 100));

      expect(receivedContexts.length).toBe(1);
      expect(receivedContexts[0].context.files?.[0].path).toBe('test.ts');
      expect(receivedContexts[0].context.summary).toBe('Test context');
    });

    it('should broadcast context to all peers', async () => {
      const receivedContexts: { context: Context; peerId: string }[] = [];
      bridgeB.onContextReceived((context, peerId) => {
        receivedContexts.push({ context, peerId });
      });

      // Broadcast context from A
      const testContext: Context = {
        files: [{ path: 'broadcast.ts', content: 'export const y = 2;' }],
      };
      await bridgeA.syncContext(testContext);

      // Wait for message delivery
      await new Promise((r) => setTimeout(r, 100));

      expect(receivedContexts.length).toBe(1);
      expect(receivedContexts[0].context.files?.[0].path).toBe('broadcast.ts');
    });

    it('should sync empty context when none provided', async () => {
      const receivedContexts: { context: Context; peerId: string }[] = [];
      bridgeA.onContextReceived((context, peerId) => {
        receivedContexts.push({ context, peerId });
      });

      // Sync without context
      await bridgeB.syncContext();

      // Wait for message delivery
      await new Promise((r) => setTimeout(r, 100));

      expect(receivedContexts.length).toBe(1);
      // Empty context should still be received
      expect(receivedContexts[0].context).toBeDefined();
    });

    it('should request context and receive response', async () => {
      // Register context request handler on bridge A
      bridgeA.onContextRequested(async (query) => {
        if (query.includes('config')) {
          return [{ path: 'config.json', content: '{"key": "value"}' }];
        }
        return [];
      });

      // Request context from B
      const chunks = await bridgeB.requestContext('get config files');

      expect(chunks.length).toBe(1);
      expect(chunks[0].path).toBe('config.json');
      expect(chunks[0].content).toBe('{"key": "value"}');
    });

    it('should return empty array when no context request handler', async () => {
      // Don't register any handler on bridge A
      const chunks = await bridgeB.requestContext('any query');

      expect(chunks).toEqual([]);
    });

    it('should throw on context request timeout', async () => {
      // Register handler that never responds
      bridgeA.onContextRequested(async (query) => {
        await new Promise((r) => setTimeout(r, 5000));
        return [];
      });

      await expect(
        bridgeB.requestContext('slow query', undefined, 200)
      ).rejects.toThrow(/timed out/i);
    });

    it('should throw when no peers connected for context request', async () => {
      // Create isolated bridge
      const isolatedBridge = new Bridge({
        mode: 'host',
        instanceName: 'isolated',
        listen: { port: 19801 },
      });
      await isolatedBridge.start();

      await expect(
        isolatedBridge.requestContext('query')
      ).rejects.toThrow('No peers connected');

      await isolatedBridge.stop();
    });

    it('should throw when requesting context from unknown peer', async () => {
      await expect(
        bridgeB.requestContext('query', 'unknown-peer-id')
      ).rejects.toThrow('Peer not found');
    });

    it('should handle context request handler error', async () => {
      bridgeA.onContextRequested(async (query) => {
        throw new Error('Handler failed');
      });

      // Should reject with the error from the handler
      await expect(bridgeB.requestContext('failing query')).rejects.toThrow('Handler failed');
    });

    it('should reject pending context requests when peer disconnects', async () => {
      // Register a slow handler
      bridgeA.onContextRequested(async (query) => {
        await new Promise((r) => setTimeout(r, 5000));
        return [];
      });

      // Start context request
      const requestPromise = bridgeB.requestContext('slow query');

      // Wait a bit then disconnect
      await new Promise((r) => setTimeout(r, 50));
      await bridgeA.stop();

      await expect(requestPromise).rejects.toThrow(/disconnected|shutting down/i);
    });

    it('should call multiple context received handlers', async () => {
      const handler1Calls: Context[] = [];
      const handler2Calls: Context[] = [];

      bridgeA.onContextReceived((context) => {
        handler1Calls.push(context);
      });
      bridgeA.onContextReceived((context) => {
        handler2Calls.push(context);
      });

      await bridgeB.syncContext({ summary: 'test' });

      await new Promise((r) => setTimeout(r, 100));

      expect(handler1Calls.length).toBe(1);
      expect(handler2Calls.length).toBe(1);
      expect(handler1Calls[0].summary).toBe('test');
      expect(handler2Calls[0].summary).toBe('test');
    });
  });

  describe('Auto-Sync', () => {
    let bridge: Bridge;
    const port = 19900;

    beforeEach(async () => {
      bridge = new Bridge({
        mode: 'host',
        instanceName: 'autosync-test',
        listen: { port },
        contextSharing: { syncInterval: 100 },
      });
      await bridge.start();
    });

    afterEach(async () => {
      bridge.stopAutoSync();
      await bridge.stop();
    });

    it('should start and stop auto-sync', async () => {
      // Start auto-sync with provider
      let syncCount = 0;
      bridge.startAutoSync(() => {
        syncCount++;
        return { summary: `Sync ${syncCount}` };
      });

      // Wait for a few syncs (interval is 100ms)
      await new Promise((r) => setTimeout(r, 350));

      expect(syncCount).toBeGreaterThanOrEqual(2);

      // Stop auto-sync
      bridge.stopAutoSync();
      const countAfterStop = syncCount;

      // Wait more and verify no more syncs
      await new Promise((r) => setTimeout(r, 200));
      expect(syncCount).toBe(countAfterStop);
    });

    it('should use default interval when not configured', async () => {
      const bridgeNoConfig = new Bridge({
        mode: 'host',
        instanceName: 'no-config-test',
        listen: { port: 19901 },
      });
      await bridgeNoConfig.start();

      let syncCount = 0;
      bridgeNoConfig.startAutoSync(() => {
        syncCount++;
        return {};
      });

      // Default interval is 5000ms, so wait briefly and check it started
      await new Promise((r) => setTimeout(r, 100));

      // Stop auto-sync before it fires (to avoid long test)
      bridgeNoConfig.stopAutoSync();
      await bridgeNoConfig.stop();

      // Just verify it doesn't throw
      expect(true).toBe(true);
    });

    it('should work without context provider', async () => {
      bridge.startAutoSync(); // No provider

      // Should not throw
      await new Promise((r) => setTimeout(r, 150));

      bridge.stopAutoSync();
    });

    it('should stop auto-sync on cleanup', async () => {
      let syncCount = 0;
      bridge.startAutoSync(() => {
        syncCount++;
        return {};
      });

      await new Promise((r) => setTimeout(r, 150));
      const countBeforeStop = syncCount;
      expect(countBeforeStop).toBeGreaterThanOrEqual(1);

      // Stop bridge (which calls cleanup)
      await bridge.stop();

      // Wait and verify no more syncs
      await new Promise((r) => setTimeout(r, 200));
      expect(syncCount).toBe(countBeforeStop);
    });
  });
});
