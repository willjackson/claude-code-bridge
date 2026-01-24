/**
 * End-to-end tests for complete bridge workflows
 *
 * Tests the full bridge lifecycle including connection, context sync,
 * task delegation, reconnection, and error recovery.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { randomUUID } from 'crypto';
import { Bridge, type BridgeConfig } from '../../src/bridge/core.js';

/**
 * Get a random available port for testing
 */
function getTestPort(): number {
  return 30000 + Math.floor(Math.random() * 10000);
}

/**
 * Wait for a condition or timeout
 */
async function waitFor(
  condition: () => boolean | Promise<boolean>,
  timeoutMs: number = 5000,
  intervalMs: number = 100
): Promise<void> {
  const startTime = Date.now();
  while (Date.now() - startTime < timeoutMs) {
    if (await condition()) return;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(`Timeout waiting for condition after ${timeoutMs}ms`);
}

describe('Full Bridge E2E Tests', () => {
  let hostBridge: Bridge;
  let clientBridge: Bridge;
  let testPort: number;

  beforeEach(() => {
    testPort = getTestPort();
  });

  afterEach(async () => {
    // Clean up bridges
    if (hostBridge) {
      try {
        await hostBridge.stop();
      } catch {
        // Ignore cleanup errors
      }
    }
    if (clientBridge) {
      try {
        await clientBridge.stop();
      } catch {
        // Ignore cleanup errors
      }
    }
    // Allow time for sockets to close
    await new Promise((resolve) => setTimeout(resolve, 100));
  });

  describe('Complete Workflow', () => {
    it('should complete full workflow: start, connect, sync, delegate, stop', async () => {
      // Step 1: Start host bridge
      const hostConfig: BridgeConfig = {
        mode: 'host',
        instanceName: 'e2e-host',
        listen: { port: testPort, host: '0.0.0.0' },
        taskTimeout: 5000,
      };
      hostBridge = new Bridge(hostConfig);
      await hostBridge.start();

      expect(hostBridge.getPeerCount()).toBe(0);

      // Step 2: Connect client bridge
      const clientConfig: BridgeConfig = {
        mode: 'client',
        instanceName: 'e2e-client',
        connect: { url: `ws://localhost:${testPort}` },
        taskTimeout: 5000,
      };
      clientBridge = new Bridge(clientConfig);
      await clientBridge.start();

      // Wait for connection
      await waitFor(() => hostBridge.getPeerCount() > 0 && clientBridge.getPeerCount() > 0);

      expect(hostBridge.getPeerCount()).toBe(1);
      expect(clientBridge.getPeerCount()).toBe(1);

      // Step 3: Sync context from client to host
      let receivedContext = false;
      hostBridge.onContextReceived((context) => {
        expect(context.summary).toBe('Test context sync');
        receivedContext = true;
      });

      await clientBridge.syncContext({
        summary: 'Test context sync',
        files: [{ path: 'test.ts', content: 'console.log("test");' }],
      });

      await waitFor(() => receivedContext);
      expect(receivedContext).toBe(true);

      // Step 4: Delegate task from host to client
      let taskReceived = false;
      clientBridge.onTaskReceived(async (task) => {
        taskReceived = true;
        return {
          success: true,
          data: { result: 'Task completed' },
        };
      });

      const taskResult = await hostBridge.delegateTask({
        id: randomUUID(),
        description: 'Test task',
        scope: 'execute',
      });

      expect(taskReceived).toBe(true);
      expect(taskResult.success).toBe(true);
      expect(taskResult.data?.result).toBe('Task completed');

      // Step 5: Stop both bridges
      await clientBridge.stop();
      await hostBridge.stop();

      expect(hostBridge.getPeerCount()).toBe(0);
      expect(clientBridge.getPeerCount()).toBe(0);
    }, 15000);
  });

  describe('Reconnection Scenarios', () => {
    it('should handle client disconnect and reconnect', async () => {
      // Start host
      const hostConfig: BridgeConfig = {
        mode: 'host',
        instanceName: 'e2e-host',
        listen: { port: testPort, host: '0.0.0.0' },
        taskTimeout: 5000,
      };
      hostBridge = new Bridge(hostConfig);
      await hostBridge.start();

      // Track peer events
      let connectCount = 0;
      let disconnectCount = 0;
      hostBridge.onPeerConnected(() => connectCount++);
      hostBridge.onPeerDisconnected(() => disconnectCount++);

      // Connect client
      const clientConfig: BridgeConfig = {
        mode: 'client',
        instanceName: 'e2e-client',
        connect: { url: `ws://localhost:${testPort}` },
        taskTimeout: 5000,
      };
      clientBridge = new Bridge(clientConfig);
      await clientBridge.start();

      await waitFor(() => hostBridge.getPeerCount() > 0);
      expect(connectCount).toBe(1);

      // Disconnect client
      await clientBridge.stop();
      await waitFor(() => hostBridge.getPeerCount() === 0);
      expect(disconnectCount).toBe(1);

      // Reconnect new client
      clientBridge = new Bridge(clientConfig);
      await clientBridge.start();
      await waitFor(() => hostBridge.getPeerCount() > 0);
      expect(connectCount).toBe(2);
    }, 10000);

    it('should handle multiple sequential connections', async () => {
      // Start host
      const hostConfig: BridgeConfig = {
        mode: 'host',
        instanceName: 'e2e-host',
        listen: { port: testPort, host: '0.0.0.0' },
        taskTimeout: 5000,
      };
      hostBridge = new Bridge(hostConfig);
      await hostBridge.start();

      // Connect and disconnect multiple clients
      for (let i = 0; i < 3; i++) {
        const clientConfig: BridgeConfig = {
          mode: 'client',
          instanceName: `e2e-client-${i}`,
          connect: { url: `ws://localhost:${testPort}` },
          taskTimeout: 5000,
        };
        clientBridge = new Bridge(clientConfig);
        await clientBridge.start();

        await waitFor(() => hostBridge.getPeerCount() > 0);
        expect(hostBridge.getPeerCount()).toBe(1);

        await clientBridge.stop();
        await waitFor(() => hostBridge.getPeerCount() === 0);
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    }, 15000);
  });

  describe('Error Recovery', () => {
    it('should handle task timeout gracefully', async () => {
      // Start host with short timeout
      const hostConfig: BridgeConfig = {
        mode: 'host',
        instanceName: 'e2e-host',
        listen: { port: testPort, host: '0.0.0.0' },
        taskTimeout: 500, // Very short timeout
      };
      hostBridge = new Bridge(hostConfig);
      await hostBridge.start();

      // Start client that delays task response
      const clientConfig: BridgeConfig = {
        mode: 'client',
        instanceName: 'e2e-client',
        connect: { url: `ws://localhost:${testPort}` },
        taskTimeout: 5000,
      };
      clientBridge = new Bridge(clientConfig);

      // Slow task handler
      clientBridge.onTaskReceived(async () => {
        await new Promise((resolve) => setTimeout(resolve, 2000)); // Longer than timeout
        return { success: true, data: {} };
      });

      await clientBridge.start();
      await waitFor(() => hostBridge.getPeerCount() > 0);

      // Delegate task - should timeout
      await expect(
        hostBridge.delegateTask({
          id: randomUUID(),
          description: 'Slow task',
          scope: 'execute',
        })
      ).rejects.toThrow(/timed out/i);
    }, 10000);

    it('should handle context request timeout', async () => {
      // Start host with short timeout
      const hostConfig: BridgeConfig = {
        mode: 'host',
        instanceName: 'e2e-host',
        listen: { port: testPort, host: '0.0.0.0' },
        taskTimeout: 500,
      };
      hostBridge = new Bridge(hostConfig);
      await hostBridge.start();

      // Start client that never responds to context requests
      const clientConfig: BridgeConfig = {
        mode: 'client',
        instanceName: 'e2e-client',
        connect: { url: `ws://localhost:${testPort}` },
        taskTimeout: 5000,
      };
      clientBridge = new Bridge(clientConfig);

      // Slow context handler
      clientBridge.onContextRequested(async () => {
        await new Promise((resolve) => setTimeout(resolve, 2000));
        return [];
      });

      await clientBridge.start();
      await waitFor(() => hostBridge.getPeerCount() > 0);

      // Request context - should timeout (use explicit 500ms timeout)
      try {
        await hostBridge.requestContext('test query', undefined, 500);
        expect.fail('Should have thrown timeout error');
      } catch (error) {
        expect((error as Error).message).toMatch(/timed out/i);
      }
    }, 10000);

    it('should handle rapid connect/disconnect cycles', async () => {
      // Start host
      const hostConfig: BridgeConfig = {
        mode: 'host',
        instanceName: 'e2e-host',
        listen: { port: testPort, host: '0.0.0.0' },
        taskTimeout: 5000,
      };
      hostBridge = new Bridge(hostConfig);
      await hostBridge.start();

      // Rapid connect/disconnect
      for (let i = 0; i < 5; i++) {
        const clientConfig: BridgeConfig = {
          mode: 'client',
          instanceName: `e2e-client-${i}`,
          connect: { url: `ws://localhost:${testPort}` },
          taskTimeout: 5000,
        };
        clientBridge = new Bridge(clientConfig);
        await clientBridge.start();
        await clientBridge.stop();
        await new Promise((resolve) => setTimeout(resolve, 20));
      }

      // Host should still be running
      expect(hostBridge.getPeerCount()).toBe(0);

      // Should be able to connect new client
      const finalClient: BridgeConfig = {
        mode: 'client',
        instanceName: 'e2e-final',
        connect: { url: `ws://localhost:${testPort}` },
        taskTimeout: 5000,
      };
      clientBridge = new Bridge(finalClient);
      await clientBridge.start();

      await waitFor(() => hostBridge.getPeerCount() > 0);
      expect(hostBridge.getPeerCount()).toBe(1);
    }, 15000);
  });

  describe('Bidirectional Communication', () => {
    it('should support bidirectional context sync', async () => {
      // Start peer A (host mode with listen)
      const peerAConfig: BridgeConfig = {
        mode: 'peer',
        instanceName: 'peer-a',
        listen: { port: testPort, host: '0.0.0.0' },
        taskTimeout: 5000,
      };
      hostBridge = new Bridge(peerAConfig);
      await hostBridge.start();

      // Start peer B (client mode connecting to A)
      const peerBConfig: BridgeConfig = {
        mode: 'peer',
        instanceName: 'peer-b',
        connect: { url: `ws://localhost:${testPort}` },
        taskTimeout: 5000,
      };
      clientBridge = new Bridge(peerBConfig);
      await clientBridge.start();

      await waitFor(() => hostBridge.getPeerCount() > 0 && clientBridge.getPeerCount() > 0);

      // Set up context handlers
      let aReceivedContext = false;
      let bReceivedContext = false;

      hostBridge.onContextReceived((context) => {
        if (context.summary === 'From B') aReceivedContext = true;
      });

      clientBridge.onContextReceived((context) => {
        if (context.summary === 'From A') bReceivedContext = true;
      });

      // Sync both ways
      await hostBridge.syncContext({ summary: 'From A' });
      await clientBridge.syncContext({ summary: 'From B' });

      await waitFor(() => aReceivedContext && bReceivedContext);
      expect(aReceivedContext).toBe(true);
      expect(bReceivedContext).toBe(true);
    }, 10000);

    it('should support bidirectional task delegation', async () => {
      // Start peer A
      const peerAConfig: BridgeConfig = {
        mode: 'peer',
        instanceName: 'peer-a',
        listen: { port: testPort, host: '0.0.0.0' },
        taskTimeout: 5000,
      };
      hostBridge = new Bridge(peerAConfig);
      hostBridge.onTaskReceived(async (task) => ({
        success: true,
        data: { from: 'A', task: task.description },
      }));
      await hostBridge.start();

      // Start peer B
      const peerBConfig: BridgeConfig = {
        mode: 'peer',
        instanceName: 'peer-b',
        connect: { url: `ws://localhost:${testPort}` },
        taskTimeout: 5000,
      };
      clientBridge = new Bridge(peerBConfig);
      clientBridge.onTaskReceived(async (task) => ({
        success: true,
        data: { from: 'B', task: task.description },
      }));
      await clientBridge.start();

      await waitFor(() => hostBridge.getPeerCount() > 0 && clientBridge.getPeerCount() > 0);

      // Delegate from A to B
      const resultFromB = await hostBridge.delegateTask({
        id: randomUUID(),
        description: 'Task from A',
        scope: 'execute',
      });
      expect(resultFromB.success).toBe(true);
      expect(resultFromB.data?.from).toBe('B');

      // Delegate from B to A
      const resultFromA = await clientBridge.delegateTask({
        id: randomUUID(),
        description: 'Task from B',
        scope: 'execute',
      });
      expect(resultFromA.success).toBe(true);
      expect(resultFromA.data?.from).toBe('A');
    }, 10000);
  });
});
