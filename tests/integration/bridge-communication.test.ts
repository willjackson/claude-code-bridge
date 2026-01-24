/**
 * Integration tests for Bridge-to-Bridge Communication
 * Tests complete workflows between two or more Bridge instances
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Bridge, type BridgeConfig, type PeerInfo } from '../../src/bridge/core.js';
import { type TaskRequest, type TaskResult, type Context, type FileChunk } from '../../src/bridge/protocol.js';

describe('Bridge Communication', () => {
  let bridgeA: Bridge;
  let bridgeB: Bridge;
  const portA = 29765;

  beforeEach(async () => {
    // Bridge A listens
    bridgeA = new Bridge({
      mode: 'host',
      instanceName: 'bridge-a',
      listen: { port: portA },
    });

    // Bridge B connects
    bridgeB = new Bridge({
      mode: 'client',
      instanceName: 'bridge-b',
      connect: { url: `ws://localhost:${portA}` },
    });

    await bridgeA.start();
    await bridgeB.start();

    // Wait for connection to be established
    await new Promise((r) => setTimeout(r, 200));
  });

  afterEach(async () => {
    await bridgeB.stop();
    await bridgeA.stop();
  });

  describe('Connection Establishment', () => {
    it('should establish connection between host and client bridges', () => {
      expect(bridgeA.getPeers()).toHaveLength(1);
      expect(bridgeB.getPeers()).toHaveLength(1);
    });

    it('should track peer info correctly on both sides', () => {
      const peersOnA = bridgeA.getPeers();
      const peersOnB = bridgeB.getPeers();

      expect(peersOnA[0].id).toBeDefined();
      expect(peersOnA[0].connectedAt).toBeGreaterThan(0);
      expect(peersOnA[0].lastActivity).toBeGreaterThanOrEqual(peersOnA[0].connectedAt);

      expect(peersOnB[0].id).toBeDefined();
      expect(peersOnB[0].connectedAt).toBeGreaterThan(0);
      expect(peersOnB[0].lastActivity).toBeGreaterThanOrEqual(peersOnB[0].connectedAt);
    });

    it('should call peer connected handlers on both sides', async () => {
      // Create new bridges with handlers
      const connectedOnC: PeerInfo[] = [];
      const connectedOnD: PeerInfo[] = [];

      const bridgeC = new Bridge({
        mode: 'host',
        instanceName: 'bridge-c',
        listen: { port: 29766 },
      });
      bridgeC.onPeerConnected((peer) => {
        connectedOnC.push(peer);
      });
      await bridgeC.start();

      const bridgeD = new Bridge({
        mode: 'client',
        instanceName: 'bridge-d',
        connect: { url: 'ws://localhost:29766' },
      });
      bridgeD.onPeerConnected((peer) => {
        connectedOnD.push(peer);
      });
      await bridgeD.start();

      await new Promise((r) => setTimeout(r, 200));

      expect(connectedOnC).toHaveLength(1);
      expect(connectedOnD).toHaveLength(1);
      expect(connectedOnC[0].id).toBeDefined();
      expect(connectedOnD[0].id).toBeDefined();

      await bridgeD.stop();
      await bridgeC.stop();
    });

    it('should handle disconnection gracefully', async () => {
      const disconnectedOnA: PeerInfo[] = [];
      bridgeA.onPeerDisconnected((peer) => {
        disconnectedOnA.push(peer);
      });

      expect(bridgeA.getPeerCount()).toBe(1);

      await bridgeB.stop();
      await new Promise((r) => setTimeout(r, 100));

      expect(disconnectedOnA).toHaveLength(1);
      expect(bridgeA.getPeerCount()).toBe(0);
    });

    it('should handle multiple sequential connections', async () => {
      // First client is already connected (bridgeB)
      expect(bridgeA.getPeerCount()).toBe(1);

      // Add a second client
      const bridgeC = new Bridge({
        mode: 'client',
        instanceName: 'bridge-c',
        connect: { url: `ws://localhost:${portA}` },
      });
      await bridgeC.start();
      await new Promise((r) => setTimeout(r, 100));

      expect(bridgeA.getPeerCount()).toBe(2);

      // Disconnect second client
      await bridgeC.stop();
      await new Promise((r) => setTimeout(r, 100));

      expect(bridgeA.getPeerCount()).toBe(1);
    });
  });

  describe('Context Synchronization', () => {
    it('should sync context from client to host', async () => {
      const receivedContext: { context: Context; peerId: string }[] = [];

      bridgeA.onContextReceived((ctx, peerId) => {
        receivedContext.push({ context: ctx, peerId });
      });

      await bridgeB.syncContext({
        files: [{ path: 'test.ts', content: 'const x = 1;' }],
        summary: 'Test file context',
      });

      await new Promise((r) => setTimeout(r, 100));

      expect(receivedContext).toHaveLength(1);
      expect(receivedContext[0].context.files?.[0].path).toBe('test.ts');
      expect(receivedContext[0].context.files?.[0].content).toBe('const x = 1;');
      expect(receivedContext[0].context.summary).toBe('Test file context');
    });

    it('should sync context from host to client', async () => {
      const receivedContext: { context: Context; peerId: string }[] = [];

      bridgeB.onContextReceived((ctx, peerId) => {
        receivedContext.push({ context: ctx, peerId });
      });

      await bridgeA.syncContext({
        files: [
          { path: 'api/server.ts', content: 'export class Server {}' },
          { path: 'api/routes.ts', content: 'export const routes = [];' },
        ],
        summary: 'API server context',
        tree: {
          name: 'api',
          type: 'directory',
          children: [
            { name: 'server.ts', type: 'file' },
            { name: 'routes.ts', type: 'file' },
          ],
        },
      });

      await new Promise((r) => setTimeout(r, 100));

      expect(receivedContext).toHaveLength(1);
      expect(receivedContext[0].context.files).toHaveLength(2);
      expect(receivedContext[0].context.tree?.name).toBe('api');
      expect(receivedContext[0].context.tree?.children).toHaveLength(2);
    });

    it('should sync context with shared variables', async () => {
      const receivedContext: Context[] = [];

      bridgeA.onContextReceived((ctx) => {
        receivedContext.push(ctx);
      });

      await bridgeB.syncContext({
        variables: {
          projectName: 'my-app',
          version: '1.0.0',
          settings: { debug: true, env: 'development' },
        },
      });

      await new Promise((r) => setTimeout(r, 100));

      expect(receivedContext).toHaveLength(1);
      expect(receivedContext[0].variables?.projectName).toBe('my-app');
      expect(receivedContext[0].variables?.version).toBe('1.0.0');
      expect(receivedContext[0].variables?.settings).toEqual({ debug: true, env: 'development' });
    });

    it('should request context from remote and receive response', async () => {
      // Set up context handler on host
      bridgeA.onContextRequested(async (query) => {
        if (query.includes('config')) {
          return [{ path: 'config.json', content: '{"key": "value"}' }];
        }
        if (query.includes('api')) {
          return [
            { path: 'api/index.ts', content: 'export * from "./routes";' },
            { path: 'api/routes.ts', content: 'export const routes = [];' },
          ];
        }
        return [];
      });

      // Request config files from client
      const configChunks = await bridgeB.requestContext('get config files');
      expect(configChunks).toHaveLength(1);
      expect(configChunks[0].path).toBe('config.json');

      // Request API files from client
      const apiChunks = await bridgeB.requestContext('get api files');
      expect(apiChunks).toHaveLength(2);
      expect(apiChunks[0].path).toBe('api/index.ts');
      expect(apiChunks[1].path).toBe('api/routes.ts');
    });

    it('should handle multiple context handlers', async () => {
      const handler1Calls: Context[] = [];
      const handler2Calls: Context[] = [];

      bridgeA.onContextReceived((ctx) => handler1Calls.push(ctx));
      bridgeA.onContextReceived((ctx) => handler2Calls.push(ctx));

      await bridgeB.syncContext({ summary: 'multi-handler test' });
      await new Promise((r) => setTimeout(r, 100));

      expect(handler1Calls).toHaveLength(1);
      expect(handler2Calls).toHaveLength(1);
      expect(handler1Calls[0].summary).toBe('multi-handler test');
      expect(handler2Calls[0].summary).toBe('multi-handler test');
    });
  });

  describe('Task Delegation', () => {
    it('should delegate task and receive successful result', async () => {
      // Host handles tasks
      bridgeA.onTaskReceived(async (task) => {
        return {
          success: true,
          data: { answer: `Processed: ${task.description}` },
        };
      });

      // Client delegates task
      const result = await bridgeB.delegateTask({
        id: 'task-1',
        description: 'Do something important',
        scope: 'execute',
      });

      expect(result.success).toBe(true);
      expect(result.data.answer).toBe('Processed: Do something important');
      expect(result.taskId).toBe('task-1');
    });

    it('should delegate task and receive error result', async () => {
      bridgeA.onTaskReceived(async (task) => {
        return {
          success: false,
          data: null,
          error: `Cannot process: ${task.description}`,
        };
      });

      const result = await bridgeB.delegateTask({
        id: 'task-error',
        description: 'Something that will fail',
        scope: 'execute',
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Cannot process: Something that will fail');
    });

    it('should handle task handler exception', async () => {
      bridgeA.onTaskReceived(async (task) => {
        throw new Error('Handler crashed');
      });

      const result = await bridgeB.delegateTask({
        id: 'task-exception',
        description: 'Trigger exception',
        scope: 'execute',
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Handler crashed');
    });

    it('should include artifacts in task result', async () => {
      bridgeA.onTaskReceived(async (task) => {
        return {
          success: true,
          data: { processed: true },
          artifacts: [
            { path: 'src/new-file.ts', action: 'created' as const },
            { path: 'src/modified.ts', action: 'modified' as const, diff: '+new line' },
            { path: 'src/old.ts', action: 'deleted' as const },
          ],
        };
      });

      const result = await bridgeB.delegateTask({
        id: 'artifact-task',
        description: 'Task producing artifacts',
        scope: 'execute',
      });

      expect(result.success).toBe(true);
      expect(result.artifacts).toHaveLength(3);
      expect(result.artifacts?.[0].action).toBe('created');
      expect(result.artifacts?.[1].diff).toBe('+new line');
      expect(result.artifacts?.[2].action).toBe('deleted');
    });

    it('should include followUp in task result', async () => {
      bridgeA.onTaskReceived(async (task) => {
        return {
          success: true,
          data: {},
          followUp: 'Should I also update the tests?',
        };
      });

      const result = await bridgeB.delegateTask({
        id: 'followup-task',
        description: 'Task with follow-up question',
        scope: 'analyze',
      });

      expect(result.success).toBe(true);
      expect(result.followUp).toBe('Should I also update the tests?');
    });

    it('should delegate multiple tasks in parallel', async () => {
      // Track order of task execution
      const executionOrder: string[] = [];

      bridgeA.onTaskReceived(async (task) => {
        executionOrder.push(`start-${task.id}`);
        // Simulate varying processing times
        const delay = task.id.includes('1') ? 100 : task.id.includes('2') ? 50 : 75;
        await new Promise((r) => setTimeout(r, delay));
        executionOrder.push(`end-${task.id}`);
        return {
          success: true,
          data: { taskId: task.id },
        };
      });

      const [result1, result2, result3] = await Promise.all([
        bridgeB.delegateTask({ id: 'parallel-1', description: 'Task 1', scope: 'execute' }),
        bridgeB.delegateTask({ id: 'parallel-2', description: 'Task 2', scope: 'execute' }),
        bridgeB.delegateTask({ id: 'parallel-3', description: 'Task 3', scope: 'execute' }),
      ]);

      // All tasks should complete successfully
      expect(result1.success).toBe(true);
      expect(result2.success).toBe(true);
      expect(result3.success).toBe(true);

      // Results should be correlated correctly
      expect(result1.taskId).toBe('parallel-1');
      expect(result2.taskId).toBe('parallel-2');
      expect(result3.taskId).toBe('parallel-3');

      // All tasks should have started (order may vary)
      expect(executionOrder.filter((e) => e.startsWith('start-'))).toHaveLength(3);
      expect(executionOrder.filter((e) => e.startsWith('end-'))).toHaveLength(3);
    });
  });

  describe('Timeout Handling', () => {
    it('should handle task timeout', async () => {
      // Host handler that takes too long
      bridgeA.onTaskReceived(async () => {
        await new Promise((r) => setTimeout(r, 10000)); // 10 seconds
        return { success: true, data: {} };
      });

      await expect(
        bridgeB.delegateTask({
          id: 'timeout-task',
          description: 'Timeout test',
          scope: 'execute',
          timeout: 200, // 200ms timeout
        })
      ).rejects.toThrow(/timed out/i);
    });

    it('should handle context request timeout', async () => {
      // Host handler that takes too long
      bridgeA.onContextRequested(async () => {
        await new Promise((r) => setTimeout(r, 10000));
        return [];
      });

      await expect(
        bridgeB.requestContext('slow query', undefined, 200)
      ).rejects.toThrow(/timed out/i);
    });

    it('should respect config default timeout', async () => {
      // Create bridges with custom timeout
      const hostWithTimeout = new Bridge({
        mode: 'host',
        instanceName: 'timeout-host',
        listen: { port: 29770 },
      });
      await hostWithTimeout.start();

      hostWithTimeout.onTaskReceived(async () => {
        await new Promise((r) => setTimeout(r, 1000));
        return { success: true, data: {} };
      });

      const clientWithTimeout = new Bridge({
        mode: 'client',
        instanceName: 'timeout-client',
        connect: { url: 'ws://localhost:29770' },
        taskTimeout: 100, // 100ms default timeout
      });
      await clientWithTimeout.start();
      await new Promise((r) => setTimeout(r, 100));

      await expect(
        clientWithTimeout.delegateTask({
          id: 'default-timeout-task',
          description: 'Should use config timeout',
          scope: 'execute',
        })
      ).rejects.toThrow(/timed out/i);

      await clientWithTimeout.stop();
      await hostWithTimeout.stop();
    });
  });

  describe('Error Recovery', () => {
    it('should reject pending tasks when peer disconnects', async () => {
      bridgeA.onTaskReceived(async () => {
        await new Promise((r) => setTimeout(r, 5000));
        return { success: true, data: {} };
      });

      // Start a task
      const taskPromise = bridgeB.delegateTask({
        id: 'disconnect-task',
        description: 'Will be interrupted',
        scope: 'execute',
      });

      // Wait briefly then disconnect the host
      await new Promise((r) => setTimeout(r, 50));
      await bridgeA.stop();

      await expect(taskPromise).rejects.toThrow(/disconnected|shutting down/i);
    });

    it('should reject pending context requests when peer disconnects', async () => {
      bridgeA.onContextRequested(async () => {
        await new Promise((r) => setTimeout(r, 5000));
        return [];
      });

      const requestPromise = bridgeB.requestContext('interrupted request');

      await new Promise((r) => setTimeout(r, 50));
      await bridgeA.stop();

      await expect(requestPromise).rejects.toThrow(/disconnected|shutting down/i);
    });

    it('should handle rapid connect/disconnect cycles', async () => {
      const disconnectEvents: PeerInfo[] = [];
      const connectEvents: PeerInfo[] = [];

      bridgeA.onPeerConnected((peer) => connectEvents.push(peer));
      bridgeA.onPeerDisconnected((peer) => disconnectEvents.push(peer));

      // Rapid connect/disconnect cycles
      for (let i = 0; i < 3; i++) {
        const tempClient = new Bridge({
          mode: 'client',
          instanceName: `temp-client-${i}`,
          connect: { url: `ws://localhost:${portA}` },
        });
        await tempClient.start();
        await new Promise((r) => setTimeout(r, 50));
        await tempClient.stop();
        await new Promise((r) => setTimeout(r, 50));
      }

      // Should have received 3 connect events and 3 disconnect events
      expect(connectEvents.length).toBeGreaterThanOrEqual(3);
      expect(disconnectEvents.length).toBeGreaterThanOrEqual(3);
    });
  });
});

describe('Bridge Peer Mode (Bidirectional)', () => {
  let bridgeA: Bridge;
  let bridgeB: Bridge;
  const portA = 29775;
  const portB = 29776;

  beforeEach(async () => {
    // Both bridges in peer mode
    bridgeA = new Bridge({
      mode: 'peer',
      instanceName: 'peer-a',
      listen: { port: portA },
      connect: { url: `ws://localhost:${portB}` },
    });

    bridgeB = new Bridge({
      mode: 'peer',
      instanceName: 'peer-b',
      listen: { port: portB },
    });

    // Start B first (so A can connect to it)
    await bridgeB.start();
    await bridgeA.start();

    // Wait for bidirectional connection
    await new Promise((r) => setTimeout(r, 300));
  });

  afterEach(async () => {
    await bridgeA.stop();
    await bridgeB.stop();
  });

  it('should establish bidirectional connections', () => {
    // A connects to B as client
    expect(bridgeA.getPeerCount()).toBeGreaterThanOrEqual(1);
    // B receives connection from A
    expect(bridgeB.getPeerCount()).toBeGreaterThanOrEqual(1);
  });

  it('should allow bidirectional task delegation', async () => {
    // A handles tasks
    bridgeA.onTaskReceived(async (task) => ({
      success: true,
      data: { from: 'A', task: task.description },
    }));

    // B handles tasks
    bridgeB.onTaskReceived(async (task) => ({
      success: true,
      data: { from: 'B', task: task.description },
    }));

    // B delegates to A
    const resultFromA = await bridgeB.delegateTask({
      id: 'to-a',
      description: 'Task for A',
      scope: 'execute',
    });

    // A delegates to B
    const resultFromB = await bridgeA.delegateTask({
      id: 'to-b',
      description: 'Task for B',
      scope: 'execute',
    });

    expect(resultFromA.data.from).toBe('A');
    expect(resultFromA.data.task).toBe('Task for A');

    expect(resultFromB.data.from).toBe('B');
    expect(resultFromB.data.task).toBe('Task for B');
  });

  it('should allow bidirectional context sync', async () => {
    const receivedOnA: Context[] = [];
    const receivedOnB: Context[] = [];

    bridgeA.onContextReceived((ctx) => receivedOnA.push(ctx));
    bridgeB.onContextReceived((ctx) => receivedOnB.push(ctx));

    // A sends to B
    await bridgeA.syncContext({ summary: 'from A' });
    // B sends to A
    await bridgeB.syncContext({ summary: 'from B' });

    await new Promise((r) => setTimeout(r, 100));

    // A should have received context from B
    expect(receivedOnA.some((ctx) => ctx.summary === 'from B')).toBe(true);
    // B should have received context from A
    expect(receivedOnB.some((ctx) => ctx.summary === 'from A')).toBe(true);
  });

  it('should allow bidirectional context requests', async () => {
    // A provides context
    bridgeA.onContextRequested(async (query) => {
      return [{ path: `from-a/${query}.ts`, content: 'A content' }];
    });

    // B provides context
    bridgeB.onContextRequested(async (query) => {
      return [{ path: `from-b/${query}.ts`, content: 'B content' }];
    });

    // B requests from A
    const chunksFromA = await bridgeB.requestContext('file');
    // A requests from B
    const chunksFromB = await bridgeA.requestContext('data');

    expect(chunksFromA[0].path).toBe('from-a/file.ts');
    expect(chunksFromA[0].content).toBe('A content');

    expect(chunksFromB[0].path).toBe('from-b/data.ts');
    expect(chunksFromB[0].content).toBe('B content');
  });
});

describe('Bridge Multi-Peer Scenarios', () => {
  it('should handle multiple clients connecting to one host', async () => {
    const host = new Bridge({
      mode: 'host',
      instanceName: 'multi-host',
      listen: { port: 29780 },
    });
    await host.start();

    const clients: Bridge[] = [];
    for (let i = 0; i < 3; i++) {
      const client = new Bridge({
        mode: 'client',
        instanceName: `client-${i}`,
        connect: { url: 'ws://localhost:29780' },
      });
      await client.start();
      clients.push(client);
    }

    await new Promise((r) => setTimeout(r, 200));

    // Host should have 3 peers
    expect(host.getPeerCount()).toBe(3);

    // Each client should have 1 peer (the host)
    for (const client of clients) {
      expect(client.getPeerCount()).toBe(1);
    }

    // Broadcast from host should reach all clients
    const receivedCounts = clients.map(() => [] as Context[]);
    clients.forEach((client, idx) => {
      client.onContextReceived((ctx) => receivedCounts[idx].push(ctx));
    });

    await host.syncContext({ summary: 'broadcast to all' });
    await new Promise((r) => setTimeout(r, 100));

    // All clients should receive the broadcast
    for (let i = 0; i < clients.length; i++) {
      expect(receivedCounts[i]).toHaveLength(1);
      expect(receivedCounts[i][0].summary).toBe('broadcast to all');
    }

    // Cleanup
    for (const client of clients) {
      await client.stop();
    }
    await host.stop();
  });

  it('should route tasks to specific peers', async () => {
    const host = new Bridge({
      mode: 'host',
      instanceName: 'routing-host',
      listen: { port: 29781 },
    });
    await host.start();

    // Set up handlers on each peer to track who processed tasks
    const client1 = new Bridge({
      mode: 'client',
      instanceName: 'client-1',
      connect: { url: 'ws://localhost:29781' },
    });
    await client1.start();

    const client2 = new Bridge({
      mode: 'client',
      instanceName: 'client-2',
      connect: { url: 'ws://localhost:29781' },
    });
    await client2.start();

    await new Promise((r) => setTimeout(r, 200));

    // Get peer IDs
    const peers = host.getPeers();
    expect(peers.length).toBe(2);

    const peer1Id = peers[0].id;
    const peer2Id = peers[1].id;

    // Track which tasks were received by each peer
    const tasksOnPeer1: TaskRequest[] = [];
    const tasksOnPeer2: TaskRequest[] = [];

    // Note: In this setup, client1 and client2 handle tasks from host
    // Since host has them as peers, host would delegate to them
    // But we need handlers on the clients
    client1.onTaskReceived(async (task) => {
      tasksOnPeer1.push(task);
      return { success: true, data: { handler: 'client1' } };
    });

    client2.onTaskReceived(async (task) => {
      tasksOnPeer2.push(task);
      return { success: true, data: { handler: 'client2' } };
    });

    // Delegate to specific peer
    const result1 = await host.delegateTask(
      { id: 'task-for-1', description: 'For peer 1', scope: 'execute' },
      peer1Id
    );

    const result2 = await host.delegateTask(
      { id: 'task-for-2', description: 'For peer 2', scope: 'execute' },
      peer2Id
    );

    expect(result1.data.handler).toBe('client1');
    expect(result2.data.handler).toBe('client2');

    // Cleanup
    await client2.stop();
    await client1.stop();
    await host.stop();
  });
});

describe('Bridge Auto-Sync Integration', () => {
  it('should automatically sync context at configured intervals', async () => {
    const host = new Bridge({
      mode: 'host',
      instanceName: 'autosync-host',
      listen: { port: 29785 },
      contextSharing: { syncInterval: 100 },
    });
    await host.start();

    const client = new Bridge({
      mode: 'client',
      instanceName: 'autosync-client',
      connect: { url: 'ws://localhost:29785' },
    });
    await client.start();
    await new Promise((r) => setTimeout(r, 100));

    const receivedContexts: Context[] = [];
    client.onContextReceived((ctx) => receivedContexts.push(ctx));

    // Start auto-sync with incrementing counter
    let counter = 0;
    host.startAutoSync(() => {
      counter++;
      return { summary: `auto-sync-${counter}` };
    });

    // Wait for multiple sync intervals
    await new Promise((r) => setTimeout(r, 350));

    host.stopAutoSync();

    // Should have received multiple contexts
    expect(receivedContexts.length).toBeGreaterThanOrEqual(2);
    // Context summaries should be sequential
    expect(receivedContexts.some((ctx) => ctx.summary?.includes('auto-sync-'))).toBe(true);

    await client.stop();
    await host.stop();
  });

  it('should stop auto-sync when bridge stops', async () => {
    const host = new Bridge({
      mode: 'host',
      instanceName: 'autosync-stop-host',
      listen: { port: 29786 },
      contextSharing: { syncInterval: 100 },
    });
    await host.start();

    let syncCount = 0;
    host.startAutoSync(() => {
      syncCount++;
      return {};
    });

    await new Promise((r) => setTimeout(r, 250));
    const countBeforeStop = syncCount;
    expect(countBeforeStop).toBeGreaterThanOrEqual(2);

    // Stop bridge (should stop auto-sync)
    await host.stop();

    await new Promise((r) => setTimeout(r, 200));

    // No more syncs should have occurred
    expect(syncCount).toBe(countBeforeStop);
  });
});
