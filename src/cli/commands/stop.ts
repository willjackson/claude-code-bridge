/**
 * CLI stop command - Stop the running bridge
 *
 * Reads the PID from ~/.claude-bridge/bridge.pid and sends SIGTERM
 * to gracefully stop the running bridge process.
 */

import { Command } from 'commander';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { createLogger } from '../../utils/logger.js';

const logger = createLogger('cli:stop');

/**
 * Get the PID file path
 */
function getPidFilePath(): string {
  const bridgeDir = path.join(os.homedir(), '.claude-bridge');
  return path.join(bridgeDir, 'bridge.pid');
}

/**
 * Remove PID file
 */
function removePidFile(): void {
  const pidFile = getPidFilePath();
  if (fs.existsSync(pidFile)) {
    fs.unlinkSync(pidFile);
  }
}

/**
 * Read PID from file
 * Returns null if file doesn't exist or is invalid
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
      logger.warn({ content }, 'Invalid PID file content');
      return null;
    }
    return pid;
  } catch (error) {
    logger.error({ error: (error as Error).message }, 'Failed to read PID file');
    return null;
  }
}

/**
 * Check if a process is running
 */
function isProcessRunning(pid: number): boolean {
  try {
    // Signal 0 checks if the process exists without sending a signal
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Wait for a process to exit with timeout
 */
async function waitForProcessExit(
  pid: number,
  timeoutMs: number = 5000
): Promise<boolean> {
  const startTime = Date.now();
  const checkInterval = 100;

  while (Date.now() - startTime < timeoutMs) {
    if (!isProcessRunning(pid)) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, checkInterval));
  }

  return false;
}

/**
 * Stop the bridge process
 */
async function stopBridge(): Promise<void> {
  const pid = readPidFile();

  if (pid === null) {
    console.log('Bridge is not running (no PID file found).');
    return;
  }

  // Check if process is actually running
  if (!isProcessRunning(pid)) {
    console.log(`Bridge is not running (stale PID file, process ${pid} not found).`);
    // Clean up stale PID file
    removePidFile();
    return;
  }

  console.log(`Stopping bridge (PID: ${pid})...`);

  try {
    // Send SIGTERM for graceful shutdown
    process.kill(pid, 'SIGTERM');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ESRCH') {
      // Process doesn't exist
      console.log('Bridge process not found.');
      removePidFile();
      return;
    }
    if ((error as NodeJS.ErrnoException).code === 'EPERM') {
      console.error(`Permission denied: cannot stop bridge (PID: ${pid}).`);
      console.error('Try running with elevated privileges.');
      process.exit(1);
    }
    throw error;
  }

  // Wait for process to exit
  const exited = await waitForProcessExit(pid);

  if (exited) {
    console.log('Bridge stopped successfully.');
    // Clean up PID file if the process didn't do it
    removePidFile();
  } else {
    console.log('Bridge is still shutting down. Check status with: claude-bridge status');
    // Optionally could try SIGKILL here, but we'll leave that to the user
    console.log(`To force stop: kill -9 ${pid}`);
  }
}

/**
 * Create the stop command
 */
export function createStopCommand(): Command {
  const command = new Command('stop');

  command
    .description('Stop the running bridge')
    .action(async () => {
      try {
        await stopBridge();
      } catch (error) {
        logger.error({ error: (error as Error).message }, 'Failed to stop bridge');
        console.error(`Failed to stop bridge: ${(error as Error).message}`);
        process.exit(1);
      }
    });

  return command;
}

/**
 * Export for use in CLI
 */
export { createStopCommand as stopCommand };
