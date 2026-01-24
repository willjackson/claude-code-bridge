#!/usr/bin/env node
/**
 * CLI entry point for claude-code-bridge
 *
 * Commands:
 *   start       Start the bridge server
 *   stop        Stop the running bridge
 *   status      Show bridge status and connected peers
 *   connect     Connect to a remote bridge
 *   info        Show system and configuration info
 *
 * Global options:
 *   --verbose, -v   Enable verbose logging
 *   --config        Path to config file
 */

import { Command } from 'commander';
import { createLogger } from '../utils/logger.js';
import { createStartCommand } from './commands/start.js';
import { createStopCommand } from './commands/stop.js';
import { createStatusCommand } from './commands/status.js';
import { createConnectCommand } from './commands/connect.js';
import { createInfoCommand } from './commands/info.js';
import { createMcpServerCommand } from './commands/mcp-server.js';

// Read version from package.json
// Since we're building with tsup, we import it directly
const VERSION = '0.1.0';

const logger = createLogger('cli');

/**
 * Global options interface
 */
export interface GlobalOptions {
  verbose?: boolean;
  config?: string;
}

/**
 * Create and configure the CLI program
 */
export function createProgram(): Command {
  const program = new Command();

  program
    .name('claude-bridge')
    .description('Bidirectional communication system for Claude Code instances across environments')
    .version(VERSION, '-V, --version', 'Output the version number')
    .option('-v, --verbose', 'Enable verbose logging')
    .option('--config <path>', 'Path to config file');

  // Hook to process global options before commands
  program.hook('preAction', (thisCommand) => {
    const opts = thisCommand.opts() as GlobalOptions;
    if (opts.verbose) {
      // Set log level to debug when verbose is enabled
      process.env.LOG_LEVEL = 'debug';
    }
  });

  return program;
}

/**
 * Get global options from the program
 */
export function getGlobalOptions(program: Command): GlobalOptions {
  return program.opts() as GlobalOptions;
}

/**
 * Main CLI entry point
 */
export async function main(): Promise<void> {
  const program = createProgram();

  // Add commands
  program.addCommand(createStartCommand());
  program.addCommand(createStopCommand());
  program.addCommand(createStatusCommand());
  program.addCommand(createConnectCommand());
  program.addCommand(createInfoCommand());
  program.addCommand(createMcpServerCommand());

  // Parse arguments and execute
  await program.parseAsync(process.argv);
}

// Run CLI if executed directly
main().catch((error: Error) => {
  logger.error({ err: error }, 'CLI error');
  process.exit(1);
});

// Export for programmatic use
export { createProgram as createCLI };
