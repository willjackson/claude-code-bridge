/**
 * CLI connect command - Connect to a remote bridge
 *
 * Takes a WebSocket URL and initiates a connection to a remote bridge.
 * This is a one-time connection test that verifies connectivity.
 *
 * Usage:
 *   claude-bridge connect ws://localhost:8765
 */

import { Command } from 'commander';
import { createLogger } from '../../utils/logger.js';
import { WebSocketTransport } from '../../transport/websocket.js';
import { ConnectionState } from '../../transport/interface.js';

const logger = createLogger('cli:connect');

/**
 * Validate WebSocket URL format
 * Returns true if valid, throws Error if invalid
 */
export function validateWebSocketUrl(url: string): boolean {
  // Check for ws:// or wss:// protocol
  if (!url.startsWith('ws://') && !url.startsWith('wss://')) {
    throw new Error(`Invalid URL protocol. Expected ws:// or wss://, got: ${url}`);
  }

  try {
    const parsed = new URL(url);

    // Ensure we have a valid hostname
    if (!parsed.hostname) {
      throw new Error('URL must include a hostname');
    }

    // Ensure we have a port (for WebSocket connections)
    if (!parsed.port) {
      // Default ports
      const defaultPort = parsed.protocol === 'wss:' ? '443' : '80';
      logger.debug(`No port specified, will use default: ${defaultPort}`);
    }

    return true;
  } catch (error) {
    if (error instanceof Error && error.message.includes('Invalid URL')) {
      throw new Error(`Invalid URL format: ${url}`);
    }
    throw error;
  }
}

/**
 * Connect to a remote bridge
 */
async function connectToBridge(url: string): Promise<void> {
  // Validate URL format
  try {
    validateWebSocketUrl(url);
  } catch (error) {
    console.error(`Error: ${(error as Error).message}`);
    process.exit(1);
  }

  console.log(`Connecting to bridge at ${url}...`);

  const transport = new WebSocketTransport();

  // Set up connection timeout
  const timeoutMs = 10000;
  const timeout = setTimeout(() => {
    console.error(`Error: Connection timeout after ${timeoutMs / 1000} seconds`);
    transport.disconnect().catch(() => {});
    process.exit(1);
  }, timeoutMs);

  try {
    // Attempt connection
    await transport.connect({
      url,
      reconnect: false, // Don't auto-reconnect for this test
    });

    clearTimeout(timeout);

    if (transport.getState() === ConnectionState.CONNECTED) {
      console.log('Successfully connected to bridge!');
      console.log('');
      console.log('Connection details:');
      console.log(`  URL: ${url}`);
      console.log(`  State: ${ConnectionState[transport.getState()]}`);
      console.log('');
      console.log('To start a bridge that auto-connects on startup:');
      console.log(`  claude-bridge start --connect ${url}`);
    } else {
      console.error(`Connection failed. State: ${ConnectionState[transport.getState()]}`);
      process.exit(1);
    }

    // Clean up - disconnect after successful test
    await transport.disconnect();
    console.log('\nConnection test complete. Disconnected.');
  } catch (error) {
    clearTimeout(timeout);
    const errorMessage = (error as Error).message;
    console.error(`Error: Failed to connect - ${errorMessage}`);

    // Provide helpful suggestions
    if (errorMessage.includes('ECONNREFUSED')) {
      console.log('');
      console.log('Suggestions:');
      console.log('  - Ensure a bridge is running at the specified address');
      console.log('  - Check the port number is correct');
      console.log('  - Verify no firewall is blocking the connection');
    } else if (errorMessage.includes('ENOTFOUND')) {
      console.log('');
      console.log('Suggestions:');
      console.log('  - Check the hostname is correct');
      console.log('  - Ensure DNS resolution is working');
    }

    process.exit(1);
  }
}

/**
 * Create the connect command
 */
export function createConnectCommand(): Command {
  const command = new Command('connect');

  command
    .description('Connect to a remote bridge')
    .argument('<url>', 'WebSocket URL to connect to (e.g., ws://localhost:8765)')
    .action(async (url: string) => {
      try {
        await connectToBridge(url);
      } catch (error) {
        logger.error({ error: (error as Error).message }, 'Connect command failed');
        console.error(`Error: ${(error as Error).message}`);
        process.exit(1);
      }
    });

  return command;
}

/**
 * Export for use in CLI
 */
export { createConnectCommand as connectCommand };
