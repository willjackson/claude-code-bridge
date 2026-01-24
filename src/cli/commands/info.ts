/**
 * CLI info command - Show system and configuration info
 *
 * Displays information about the current system, network configuration,
 * and loaded config values.
 */

import { Command } from 'commander';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { createLogger } from '../../utils/logger.js';
import { loadConfigSync } from '../../utils/config.js';
import type { GlobalOptions } from '../index.js';

const logger = createLogger('cli:info');

/**
 * Get the config file path that would be loaded
 */
function getConfigFilePath(): string | null {
  // Check project local config first
  const localConfig = path.join(process.cwd(), '.claude-bridge.yml');
  if (fs.existsSync(localConfig)) {
    return localConfig;
  }

  // Check home directory
  const homeConfig = path.join(os.homedir(), '.claude-bridge', 'config.yml');
  if (fs.existsSync(homeConfig)) {
    return homeConfig;
  }

  return null;
}

/**
 * Format a value for display (handle undefined, objects, etc.)
 */
function formatValue(value: unknown): string {
  if (value === undefined) {
    return '(not set)';
  }
  if (value === null) {
    return '(null)';
  }
  if (typeof value === 'object') {
    return JSON.stringify(value);
  }
  return String(value);
}

/**
 * Print a section header
 */
function printSection(title: string): void {
  console.log('');
  console.log(title);
  console.log('-'.repeat(title.length));
}

/**
 * Print a key-value pair
 */
function printKeyValue(key: string, value: unknown, indent: number = 0): void {
  const prefix = '  '.repeat(indent);
  console.log(`${prefix}${key}: ${formatValue(value)}`);
}

/**
 * Show system and configuration info
 */
function showInfo(globalOptions: GlobalOptions): void {
  console.log('Claude Code Bridge - System Information');
  console.log('='.repeat(40));

  // System Info
  printSection('System');
  printKeyValue('Node Version', process.version);
  printKeyValue('OS', `${os.type()} ${os.release()}`);
  printKeyValue('Platform', process.platform);
  printKeyValue('Arch', os.arch());
  printKeyValue('Home Directory', os.homedir());
  printKeyValue('Working Directory', process.cwd());

  // Network
  printSection('Network');
  const interfaces = os.networkInterfaces();
  for (const [name, addrs] of Object.entries(interfaces)) {
    if (addrs) {
      for (const addr of addrs) {
        if (addr.family === 'IPv4' && !addr.internal) {
          printKeyValue(name, addr.address);
        }
      }
    }
  }

  // Configuration
  printSection('Configuration');
  const configPath = globalOptions.config || getConfigFilePath();
  printKeyValue('Config File', configPath || '(using defaults)');

  const config = loadConfigSync(globalOptions.config);

  console.log('');
  console.log('  Current Settings:');
  printKeyValue('Mode', config.mode, 2);
  printKeyValue('Instance Name', config.instanceName, 2);

  console.log('');
  console.log('  Listen:');
  printKeyValue('Port', config.listen.port, 2);
  printKeyValue('Host', config.listen.host, 2);

  console.log('');
  console.log('  Connect:');
  printKeyValue('URL', config.connect?.url, 2);

  console.log('');
  console.log('  Context Sharing:');
  printKeyValue('Auto Sync', config.contextSharing.autoSync, 2);
  printKeyValue('Sync Interval', `${config.contextSharing.syncInterval}ms`, 2);
  printKeyValue('Max Chunk Tokens', config.contextSharing.maxChunkTokens, 2);

  if (config.contextSharing.includePatterns.length > 0) {
    console.log('    Include Patterns:');
    for (const pattern of config.contextSharing.includePatterns) {
      console.log(`      - ${pattern}`);
    }
  }

  if (config.contextSharing.excludePatterns.length > 0) {
    console.log('    Exclude Patterns:');
    for (const pattern of config.contextSharing.excludePatterns) {
      console.log(`      - ${pattern}`);
    }
  }

  console.log('');
  console.log('  Interaction:');
  printKeyValue('Require Confirmation', config.interaction.requireConfirmation, 2);
  printKeyValue('Notify On Activity', config.interaction.notifyOnActivity, 2);
  printKeyValue('Task Timeout', `${config.interaction.taskTimeout}ms`, 2);

  console.log('');
}

/**
 * Create the info command
 */
export function createInfoCommand(): Command {
  const command = new Command('info');

  command
    .description('Show system and configuration info')
    .action(() => {
      try {
        // Get global options from parent command
        const globalOptions = command.parent?.opts() as GlobalOptions ?? {};
        showInfo(globalOptions);
      } catch (error) {
        logger.error({ error: (error as Error).message }, 'Info command failed');
        console.error(`Error: ${(error as Error).message}`);
        process.exit(1);
      }
    });

  return command;
}

/**
 * Export for use in CLI
 */
export { createInfoCommand as infoCommand };
