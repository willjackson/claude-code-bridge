/**
 * CLI mcp-server command - Start the MCP server for Claude Code integration
 *
 * Options:
 *   --connect, -c    Bridge WebSocket URL to connect to (default: ws://localhost:8766)
 *   --name           MCP server name (default: claude-bridge)
 */

import { Command } from 'commander';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { spawn } from 'child_process';
import { createLogger } from '../../utils/logger.js';
import { BridgeMcpServer, type McpServerConfig } from '../../mcp/server.js';
import { setupGracefulShutdown, handleUnhandledRejections } from '../utils.js';
import type { GlobalOptions } from '../index.js';
import type { TLSConfig, AuthConfig } from '../../transport/interface.js';

const logger = createLogger('cli:mcp-server');

/**
 * Options for the mcp-server command
 */
export interface McpServerCommandOptions {
  connect?: string;
  name?: string;
  // TLS options
  ca?: string;
  noVerifyTls?: boolean;
  // Auth options
  authToken?: string;
  authPassword?: string;
}

/**
 * Default bridge daemon port
 */
const DEFAULT_DAEMON_PORT = 8766;

/**
 * Get the status file path
 */
function getStatusFilePath(): string {
  const bridgeDir = path.join(os.homedir(), '.claude-bridge');
  return path.join(bridgeDir, 'status.json');
}

/**
 * Get the PID file path
 */
function getPidFilePath(): string {
  const bridgeDir = path.join(os.homedir(), '.claude-bridge');
  return path.join(bridgeDir, 'bridge.pid');
}

/**
 * Check if bridge daemon is running
 */
function isDaemonRunning(): { running: boolean; pid?: number; port?: number } {
  const pidFile = getPidFilePath();

  if (!fs.existsSync(pidFile)) {
    return { running: false };
  }

  try {
    const pid = parseInt(fs.readFileSync(pidFile, 'utf-8').trim(), 10);
    // Check if process is still running
    process.kill(pid, 0); // Signal 0 checks existence without killing

    // Try to read port from status file
    const statusFile = getStatusFilePath();
    if (fs.existsSync(statusFile)) {
      const status = JSON.parse(fs.readFileSync(statusFile, 'utf-8'));
      return { running: true, pid, port: status.port };
    }

    return { running: true, pid };
  } catch {
    // Process doesn't exist or status file invalid
    return { running: false };
  }
}

/**
 * Wait for daemon to be ready
 */
async function waitForDaemon(port: number, timeoutMs: number): Promise<void> {
  const startTime = Date.now();

  while (Date.now() - startTime < timeoutMs) {
    const { running, port: runningPort } = isDaemonRunning();
    if (running && (runningPort === port || runningPort === undefined)) {
      // Give it a moment to be fully ready
      await new Promise(resolve => setTimeout(resolve, 500));
      return;
    }
    await new Promise(resolve => setTimeout(resolve, 200));
  }

  throw new Error(`Daemon did not start within ${timeoutMs}ms`);
}

/**
 * Ensure the .claude-bridge directory exists
 */
function ensureBridgeDir(): void {
  const bridgeDir = path.join(os.homedir(), '.claude-bridge');
  if (!fs.existsSync(bridgeDir)) {
    fs.mkdirSync(bridgeDir, { recursive: true });
  }
}

/**
 * Start bridge daemon if not running
 */
async function ensureDaemonRunning(port: number): Promise<number> {
  const { running, pid, port: runningPort } = isDaemonRunning();

  if (running) {
    const effectivePort = runningPort ?? port;
    console.error(`[MCP] Bridge daemon already running (PID: ${pid}, port: ${effectivePort})`);
    return effectivePort;
  }

  console.error('[MCP] Starting bridge daemon...');
  ensureBridgeDir();

  const logFile = path.join(os.homedir(), '.claude-bridge', 'bridge.log');

  // Spawn daemon process
  const out = fs.openSync(logFile, 'a');
  const err = fs.openSync(logFile, 'a');

  // Find the CLI entry point
  // When running from npx or installed globally, process.argv[1] is the CLI script
  const cliPath = process.argv[1];

  const child = spawn(process.execPath, [cliPath, 'start', '--daemon', '--port', String(port)], {
    detached: true,
    stdio: ['ignore', out, err],
  });

  child.unref();

  console.error(`[MCP] Daemon starting (PID: ${child.pid})`);

  // Wait for daemon to be ready
  try {
    await waitForDaemon(port, 5000);
    console.error(`[MCP] Daemon ready on port ${port}`);
    return port;
  } catch (error) {
    console.error(`[MCP] Warning: Could not verify daemon is ready: ${(error as Error).message}`);
    // Continue anyway, the bridge connection will fail if daemon isn't running
    return port;
  }
}

/**
 * Start the MCP server
 */
async function startMcpServer(
  options: McpServerCommandOptions,
  _globalOptions: GlobalOptions
): Promise<void> {
  // Parse connection URL
  let bridgeUrl = options.connect ?? `ws://localhost:${DEFAULT_DAEMON_PORT}`;

  // If no explicit URL provided, try to auto-start daemon
  if (!options.connect) {
    try {
      const port = await ensureDaemonRunning(DEFAULT_DAEMON_PORT);
      bridgeUrl = `ws://localhost:${port}`;
    } catch (error) {
      console.error(`[MCP] Warning: Could not ensure daemon is running: ${(error as Error).message}`);
    }
  }

  // Build TLS config from options
  let tlsConfig: TLSConfig | undefined;
  if (options.ca || options.noVerifyTls) {
    tlsConfig = {
      ca: options.ca,
      rejectUnauthorized: options.noVerifyTls ? false : true,
    };
  }

  // Build auth config from options
  let authConfig: AuthConfig | undefined;
  if (options.authToken || options.authPassword) {
    const hasToken = !!options.authToken;
    const hasPassword = !!options.authPassword;

    authConfig = {
      type: hasToken && hasPassword ? 'combined' : hasToken ? 'token' : 'password',
      token: options.authToken,
      password: options.authPassword,
    };
  }

  // Build MCP server config
  const config: McpServerConfig = {
    bridgeUrl,
    name: options.name ?? 'claude-bridge',
    version: '0.4.0',
    instanceName: `mcp-server-${process.pid}`,
    taskTimeout: 60000,
    tls: tlsConfig,
    auth: authConfig,
  };

  // Create and start MCP server
  const server = new BridgeMcpServer(config);

  // Set up graceful shutdown handling
  setupGracefulShutdown({
    cleanup: async () => {
      console.error('[MCP] Shutting down...');
      await server.stop();
    },
    verbose: false,
    timeout: 5000,
  });

  // Handle unhandled promise rejections
  handleUnhandledRejections({
    exit: true,
    logger: (msg, err) => {
      console.error(`[MCP] ${msg}: ${err.message}`);
      logger.error({ error: err.message }, msg);
    },
  });

  try {
    await server.start();
    // Server is now running and listening on stdio
    // It will keep running until interrupted
  } catch (error) {
    console.error(`[MCP] Failed to start MCP server: ${(error as Error).message}`);
    process.exit(1);
  }
}

/**
 * Create the mcp-server command
 */
export function createMcpServerCommand(): Command {
  const command = new Command('mcp-server');

  command
    .description('Start the MCP server for Claude Code integration')
    .option('-c, --connect <url>', `Bridge WebSocket URL (default: ws://localhost:${DEFAULT_DAEMON_PORT})`)
    .option('--name <name>', 'MCP server name (default: claude-bridge)')
    // TLS options
    .option('--ca <path>', 'CA certificate for verifying self-signed certs')
    .option('--no-verify-tls', 'Skip TLS certificate verification (insecure)')
    // Auth options
    .option('--auth-token <token>', 'Token for authentication')
    .option('--auth-password <password>', 'Password for authentication')
    .action(async (options: McpServerCommandOptions) => {
      // Get global options from parent command
      const globalOptions = command.parent?.opts() as GlobalOptions;
      await startMcpServer(options, globalOptions);
    });

  return command;
}

/**
 * Export the command for use in CLI
 */
export { createMcpServerCommand as mcpServerCommand };
