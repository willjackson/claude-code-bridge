/**
 * CLI status command - Show bridge status and connected peers
 *
 * Displays whether the bridge is running, what port it's on,
 * and lists connected peers in a formatted table.
 *
 * Options:
 *   --port    Check status for a specific port
 */

import { Command } from 'commander';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { createLogger } from '../../utils/logger.js';

const logger = createLogger('cli:status');

/**
 * Options for the status command
 */
export interface StatusCommandOptions {
  port?: string;
}

/**
 * Bridge status information
 */
export interface BridgeStatus {
  running: boolean;
  pid?: number;
  port?: number;
  peers?: PeerStatus[];
}

/**
 * Peer status information
 */
export interface PeerStatus {
  id: string;
  name: string;
  connectedAt: string;
  lastActivity: string;
}

/**
 * Get the PID file path
 */
function getPidFilePath(): string {
  const bridgeDir = path.join(os.homedir(), '.claude-bridge');
  return path.join(bridgeDir, 'bridge.pid');
}

/**
 * Get the status file path (where bridge writes current status)
 */
function getStatusFilePath(): string {
  const bridgeDir = path.join(os.homedir(), '.claude-bridge');
  return path.join(bridgeDir, 'status.json');
}

/**
 * Read PID from file
 */
function readPidFile(): number | null {
  const pidFile = getPidFilePath();
  if (!fs.existsSync(pidFile)) {
    return null;
  }

  try {
    const content = fs.readFileSync(pidFile, 'utf-8').trim();
    const pid = parseInt(content, 10);
    if (isNaN(pid) || pid <= 0) {
      return null;
    }
    return pid;
  } catch {
    return null;
  }
}

/**
 * Check if a process is running
 */
function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Read status file written by the bridge
 */
function readStatusFile(): { port?: number; peers?: PeerStatus[] } | null {
  const statusFile = getStatusFilePath();
  if (!fs.existsSync(statusFile)) {
    return null;
  }

  try {
    const content = fs.readFileSync(statusFile, 'utf-8');
    return JSON.parse(content);
  } catch {
    return null;
  }
}

/**
 * Format a date for display
 */
function formatDate(dateStr: string): string {
  try {
    const date = new Date(dateStr);
    return date.toLocaleString();
  } catch {
    return dateStr;
  }
}

/**
 * Pad a string to a specific width
 */
function padRight(str: string, width: number): string {
  return str.padEnd(width);
}

/**
 * Print peer table
 */
function printPeerTable(peers: PeerStatus[]): void {
  if (peers.length === 0) {
    console.log('  No peers connected.');
    return;
  }

  // Column headers and widths
  const cols = {
    id: { title: 'ID', width: 38 },
    name: { title: 'Name', width: 20 },
    connected: { title: 'Connected', width: 22 },
    lastActivity: { title: 'Last Activity', width: 22 },
  };

  // Print header
  console.log('');
  console.log(
    '  ' +
      padRight(cols.id.title, cols.id.width) +
      padRight(cols.name.title, cols.name.width) +
      padRight(cols.connected.title, cols.connected.width) +
      padRight(cols.lastActivity.title, cols.lastActivity.width)
  );

  // Print separator
  const separator =
    '  ' +
    '-'.repeat(cols.id.width - 1) +
    ' ' +
    '-'.repeat(cols.name.width - 1) +
    ' ' +
    '-'.repeat(cols.connected.width - 1) +
    ' ' +
    '-'.repeat(cols.lastActivity.width - 1);
  console.log(separator);

  // Print rows
  for (const peer of peers) {
    const row =
      '  ' +
      padRight(peer.id, cols.id.width) +
      padRight(peer.name.slice(0, cols.name.width - 1), cols.name.width) +
      padRight(formatDate(peer.connectedAt), cols.connected.width) +
      padRight(formatDate(peer.lastActivity), cols.lastActivity.width);
    console.log(row);
  }

  console.log('');
}

/**
 * Get bridge status
 */
function getBridgeStatus(): BridgeStatus {
  const pid = readPidFile();

  if (pid === null) {
    return { running: false };
  }

  if (!isProcessRunning(pid)) {
    // PID file exists but process is not running
    return { running: false };
  }

  // Process is running, try to get more details
  const statusInfo = readStatusFile();

  return {
    running: true,
    pid,
    port: statusInfo?.port,
    peers: statusInfo?.peers,
  };
}

/**
 * Show bridge status
 */
function showStatus(options: StatusCommandOptions): void {
  console.log('Claude Code Bridge Status');
  console.log('='.repeat(26));
  console.log('');

  const status = getBridgeStatus();

  if (!status.running) {
    console.log('Status: stopped');
    console.log('');
    console.log('To start the bridge:');
    console.log('  claude-bridge start');
    return;
  }

  console.log('Status: running');
  console.log(`PID: ${status.pid}`);

  if (status.port !== undefined) {
    console.log(`Port: ${status.port}`);
  }

  console.log('');
  console.log('Connected Peers:');

  if (status.peers) {
    printPeerTable(status.peers);
  } else {
    console.log('  Unable to retrieve peer information.');
    console.log('  (Status file not found or unreadable)');
  }

  console.log('To stop the bridge:');
  console.log('  claude-bridge stop');
}

/**
 * Create the status command
 */
export function createStatusCommand(): Command {
  const command = new Command('status');

  command
    .description('Show bridge status and connected peers')
    .option('-p, --port <port>', 'Check status for a specific port')
    .action((options: StatusCommandOptions) => {
      try {
        showStatus(options);
      } catch (error) {
        logger.error({ error: (error as Error).message }, 'Failed to get status');
        console.error(`Failed to get status: ${(error as Error).message}`);
        process.exit(1);
      }
    });

  return command;
}

/**
 * Export for use in CLI
 */
export { createStatusCommand as statusCommand };
