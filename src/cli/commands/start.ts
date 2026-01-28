/**
 * CLI start command - Start the bridge server
 *
 * Options:
 *   --port, -p         Port to listen on (default: 8765)
 *   --host, -h         Host to bind to (default: 0.0.0.0)
 *   --connect, -c      URL to connect to on startup
 *   --daemon, -d       Run in background
 *   --with-handlers    Enable file reading and task handling capabilities
 *   --launch-claude    Start bridge daemon and launch Claude Code
 *   [claude-args...]   Arguments to pass to Claude Code (after --)
 *
 * Example:
 *   claude-bridge start --port 8766 --launch-claude -- --dangerously-skip-permissions
 */

import { Command } from 'commander';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { spawn } from 'child_process';
import { minimatch } from 'minimatch';
import { createLogger } from '../../utils/logger.js';
import { loadConfigSync, type BridgeConfig as UtilsBridgeConfig } from '../../utils/config.js';
import { Bridge, type BridgeConfig, type BridgeMode, type TaskRequest, type FileChunk } from '../../bridge/core.js';
import { setupGracefulShutdown, handleUnhandledRejections } from '../utils.js';
import { validateTLSConfig, isTLSEnabled, type TLSConfig } from '../../utils/tls.js';
import { createAuthConfigFromOptions, validateAuthConfig, type AuthConfig } from '../../utils/auth.js';
import type { GlobalOptions } from '../index.js';

const logger = createLogger('cli:start');

/**
 * Options for the start command
 */
export interface StartCommandOptions {
  port?: string;
  host?: string;
  connect?: string;
  daemon?: boolean;
  withHandlers?: boolean;
  launchClaude?: boolean;
  claudeArgs?: string[];
  // TLS options
  cert?: string;
  key?: string;
  ca?: string;
  // Auth options
  authToken?: string;
  authPassword?: string;
  authIp?: string[];
  authRequireAll?: boolean;
}

/**
 * Get the PID file path
 */
function getPidFilePath(): string {
  const bridgeDir = path.join(os.homedir(), '.claude-bridge');
  return path.join(bridgeDir, 'bridge.pid');
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
 * Write PID file for daemon mode
 */
function writePidFile(pid: number): void {
  ensureBridgeDir();
  const pidFile = getPidFilePath();
  fs.writeFileSync(pidFile, pid.toString(), 'utf-8');
}

/**
 * Remove PID file on shutdown
 */
function removePidFile(): void {
  const pidFile = getPidFilePath();
  if (fs.existsSync(pidFile)) {
    fs.unlinkSync(pidFile);
  }
}

/**
 * Check if a bridge is already running by checking the PID file
 */
function isAlreadyRunning(): { running: boolean; pid?: number } {
  const pidFile = getPidFilePath();
  if (!fs.existsSync(pidFile)) {
    return { running: false };
  }

  try {
    const pid = parseInt(fs.readFileSync(pidFile, 'utf-8').trim(), 10);
    // Check if process is still running
    process.kill(pid, 0); // Signal 0 checks existence without killing
    return { running: true, pid };
  } catch {
    // Process doesn't exist, clean up stale PID file
    removePidFile();
    return { running: false };
  }
}

/**
 * Get all files in a directory recursively
 */
function getFilesRecursively(dir: string, baseDir: string = dir): string[] {
  const files: string[] = [];

  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      const relativePath = path.relative(baseDir, fullPath);

      if (entry.isDirectory()) {
        // Skip common directories
        if (['node_modules', '.git', 'dist', 'build', '.next', 'coverage'].includes(entry.name)) {
          continue;
        }
        files.push(...getFilesRecursively(fullPath, baseDir));
      } else if (entry.isFile()) {
        files.push(relativePath);
      }
    }
  } catch {
    // Ignore permission errors
  }

  return files;
}

/**
 * Check if a file matches any of the patterns
 */
function matchesPatterns(filePath: string, patterns: string[]): boolean {
  return patterns.some(pattern => minimatch(filePath, pattern, { dot: true }));
}

/**
 * Read file contents safely
 */
function readFileSafe(filePath: string, maxSize: number = 100000): string | null {
  try {
    const stats = fs.statSync(filePath);
    if (stats.size > maxSize) {
      return `[File too large: ${stats.size} bytes]`;
    }
    return fs.readFileSync(filePath, 'utf-8');
  } catch {
    return null;
  }
}

/**
 * Register handlers for file reading and task processing
 */
function registerHandlers(
  bridge: Bridge,
  config: { includePatterns: string[]; excludePatterns: string[] }
): void {
  const cwd = process.cwd();

  // Handler for context requests - find and return relevant files
  bridge.onContextRequested(async (query: string, peerId: string): Promise<FileChunk[]> => {
    logger.info({ query, peerId }, 'Context requested');

    const files = getFilesRecursively(cwd);
    const chunks: FileChunk[] = [];
    const queryLower = query.toLowerCase();
    const queryTerms = queryLower.split(/\s+/).filter(t => t.length > 2);

    for (const file of files) {
      // Check exclude patterns
      if (matchesPatterns(file, config.excludePatterns)) {
        continue;
      }

      // Check if file matches query or include patterns
      const fileLower = file.toLowerCase();
      const matchesQuery = queryTerms.some(term => fileLower.includes(term));
      const matchesInclude = matchesPatterns(file, config.includePatterns);

      if (matchesQuery || matchesInclude) {
        const fullPath = path.join(cwd, file);
        const content = readFileSafe(fullPath);

        if (content !== null) {
          chunks.push({
            path: file,
            content,
            language: path.extname(file).slice(1) || undefined,
          });
        }

        // Limit number of files returned
        if (chunks.length >= 20) {
          break;
        }
      }
    }

    logger.info({ fileCount: chunks.length, query }, 'Context response prepared');
    return chunks;
  });

  // Handler for incoming tasks
  bridge.onTaskReceived(async (task: TaskRequest, peerId: string) => {
    logger.info({ taskId: task.id, description: task.description, peerId }, 'Task received');

    // Check for file operations in task data
    const taskData = task.data as Record<string, unknown> | undefined;
    const action = taskData?.action as string | undefined;

    // Log incoming command details to console
    console.log('\n┌─────────────────────────────────────────────────────────────');
    console.log(`│ 📥 INCOMING TASK: ${task.description}`);
    console.log(`│ ID: ${task.id}`);
    console.log(`│ Scope: ${task.scope}`);
    if (action) {
      console.log(`│ Action: ${action}`);
      if (taskData?.path) {
        console.log(`│ Path: ${taskData.path}`);
      }
    }
    console.log('└─────────────────────────────────────────────────────────────\n');

    // Handle file write action
    if (taskData?.action === 'write_file') {
      const filePath = taskData.path as string;
      const content = taskData.content as string;

      if (!filePath || content === undefined) {
        console.log('  ❌ RESULT: write_file requires path and content');
        return {
          success: false,
          data: { error: 'write_file requires path and content' },
        };
      }

      // Resolve path relative to cwd
      const fullPath = path.isAbsolute(filePath) ? filePath : path.join(cwd, filePath);

      // Security: ensure path is within cwd
      const resolvedPath = path.resolve(fullPath);
      const resolvedCwd = path.resolve(cwd);
      if (!resolvedPath.startsWith(resolvedCwd)) {
        console.log('  ❌ RESULT: Cannot write files outside project directory');
        return {
          success: false,
          data: { error: 'Cannot write files outside project directory' },
        };
      }

      try {
        // Ensure parent directory exists
        const parentDir = path.dirname(resolvedPath);
        if (!fs.existsSync(parentDir)) {
          fs.mkdirSync(parentDir, { recursive: true });
        }

        fs.writeFileSync(resolvedPath, content, 'utf-8');
        const bytesWritten = Buffer.byteLength(content, 'utf-8');
        logger.info({ path: filePath }, 'File written successfully');
        console.log(`  ✅ RESULT: Wrote ${bytesWritten} bytes to ${filePath}`);

        return {
          success: true,
          data: {
            action: 'write_file',
            path: filePath,
            bytesWritten,
          },
        };
      } catch (err) {
        logger.error({ error: (err as Error).message, path: filePath }, 'Failed to write file');
        console.log(`  ❌ RESULT: Failed to write file: ${(err as Error).message}`);
        return {
          success: false,
          data: { error: `Failed to write file: ${(err as Error).message}` },
        };
      }
    }

    // Handle file read action
    if (taskData?.action === 'read_file') {
      const filePath = taskData.path as string;

      if (!filePath) {
        console.log('  ❌ RESULT: read_file requires path');
        return {
          success: false,
          data: { error: 'read_file requires path' },
        };
      }

      const fullPath = path.isAbsolute(filePath) ? filePath : path.join(cwd, filePath);
      const content = readFileSafe(fullPath);

      if (content === null) {
        console.log(`  ❌ RESULT: Cannot read file: ${filePath}`);
        return {
          success: false,
          data: { error: `Cannot read file: ${filePath}` },
        };
      }

      console.log(`  ✅ RESULT: Read ${content.length} chars from ${filePath}`);
      return {
        success: true,
        data: {
          action: 'read_file',
          path: filePath,
          content,
        },
      };
    }

    // Handle delete file action
    if (taskData?.action === 'delete_file') {
      const filePath = taskData.path as string;

      if (!filePath) {
        console.log('  ❌ RESULT: delete_file requires path');
        return {
          success: false,
          data: { error: 'delete_file requires path' },
        };
      }

      const fullPath = path.isAbsolute(filePath) ? filePath : path.join(cwd, filePath);

      // Security: ensure path is within cwd
      const resolvedPath = path.resolve(fullPath);
      const resolvedCwd = path.resolve(cwd);
      if (!resolvedPath.startsWith(resolvedCwd)) {
        console.log('  ❌ RESULT: Cannot delete files outside project directory');
        return {
          success: false,
          data: { error: 'Cannot delete files outside project directory' },
        };
      }

      try {
        if (!fs.existsSync(resolvedPath)) {
          console.log(`  ❌ RESULT: File not found: ${filePath}`);
          return {
            success: false,
            data: { error: `File not found: ${filePath}` },
          };
        }

        fs.unlinkSync(resolvedPath);
        logger.info({ path: filePath }, 'File deleted successfully');
        console.log(`  ✅ RESULT: Deleted ${filePath}`);

        return {
          success: true,
          data: {
            action: 'delete_file',
            path: filePath,
          },
        };
      } catch (err) {
        logger.error({ error: (err as Error).message, path: filePath }, 'Failed to delete file');
        console.log(`  ❌ RESULT: Failed to delete file: ${(err as Error).message}`);
        return {
          success: false,
          data: { error: `Failed to delete file: ${(err as Error).message}` },
        };
      }
    }

    // Handle list directory action
    if (taskData?.action === 'list_directory') {
      const dirPath = taskData.path as string;

      if (!dirPath) {
        console.log('  ❌ RESULT: list_directory requires path');
        return {
          success: false,
          data: { error: 'list_directory requires path' },
        };
      }

      const fullPath = path.isAbsolute(dirPath) ? dirPath : path.join(cwd, dirPath);

      // Security: ensure path is within cwd
      const resolvedPath = path.resolve(fullPath);
      const resolvedCwd = path.resolve(cwd);
      if (!resolvedPath.startsWith(resolvedCwd)) {
        console.log('  ❌ RESULT: Cannot list directories outside project directory');
        return {
          success: false,
          data: { error: 'Cannot list directories outside project directory' },
        };
      }

      try {
        if (!fs.existsSync(resolvedPath)) {
          console.log(`  ❌ RESULT: Directory not found: ${dirPath}`);
          return {
            success: false,
            data: { error: `Directory not found: ${dirPath}` },
          };
        }

        const stats = fs.statSync(resolvedPath);
        if (!stats.isDirectory()) {
          console.log(`  ❌ RESULT: Not a directory: ${dirPath}`);
          return {
            success: false,
            data: { error: `Not a directory: ${dirPath}` },
          };
        }

        const entries = fs.readdirSync(resolvedPath, { withFileTypes: true });
        const listing = entries.map(entry => ({
          name: entry.name,
          type: entry.isDirectory() ? 'directory' : 'file',
        }));

        logger.info({ path: dirPath, count: listing.length }, 'Directory listed successfully');
        console.log(`  ✅ RESULT: Listed ${listing.length} entries in ${dirPath}`);

        return {
          success: true,
          data: {
            action: 'list_directory',
            path: dirPath,
            entries: listing,
          },
        };
      } catch (err) {
        logger.error({ error: (err as Error).message, path: dirPath }, 'Failed to list directory');
        console.log(`  ❌ RESULT: Failed to list directory: ${(err as Error).message}`);
        return {
          success: false,
          data: { error: `Failed to list directory: ${(err as Error).message}` },
        };
      }
    }

    // Default: Get project info for the response
    const projectInfo: Record<string, unknown> = {
      cwd,
      platform: process.platform,
      nodeVersion: process.version,
    };

    // Try to read package.json for project details
    const pkgPath = path.join(cwd, 'package.json');
    if (fs.existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
        projectInfo.name = pkg.name;
        projectInfo.version = pkg.version;
        projectInfo.description = pkg.description;
        projectInfo.dependencies = Object.keys(pkg.dependencies || {});
        projectInfo.devDependencies = Object.keys(pkg.devDependencies || {});
      } catch {
        // Ignore parse errors
      }
    }

    // List top-level files and directories
    try {
      const entries = fs.readdirSync(cwd, { withFileTypes: true });
      projectInfo.structure = entries
        .filter(e => !e.name.startsWith('.') && e.name !== 'node_modules')
        .map(e => ({
          name: e.name,
          type: e.isDirectory() ? 'directory' : 'file',
        }));
    } catch {
      // Ignore errors
    }

    // Get source files summary
    const allFiles = getFilesRecursively(cwd);
    const sourceFiles = allFiles.filter(f =>
      matchesPatterns(f, config.includePatterns) &&
      !matchesPatterns(f, config.excludePatterns)
    );
    projectInfo.sourceFileCount = sourceFiles.length;
    projectInfo.sourceFiles = sourceFiles.slice(0, 50); // First 50 files

    return {
      success: true,
      data: {
        message: `Task received and analyzed: ${task.description}`,
        scope: task.scope,
        projectInfo,
      },
    };
  });

  // Handler for incoming context sync
  bridge.onContextReceived((context, peerId) => {
    logger.info(
      {
        peerId,
        fileCount: context.files?.length || 0,
        summary: context.summary
      },
      'Context received from peer'
    );

    if (context.files) {
      for (const file of context.files) {
        console.log(`  📄 Received: ${file.path} (${file.content?.length || 0} chars)`);
      }
    }
    if (context.summary) {
      console.log(`  📝 Summary: ${context.summary}`);
    }
  });

  logger.info('Handlers registered for context requests, tasks, and context sync');
  console.log('  Handlers: enabled (file reading & task processing)');
}

/**
 * Build TLS configuration from CLI options
 */
function buildTLSConfig(options: StartCommandOptions): TLSConfig | undefined {
  if (!options.cert && !options.key && !options.ca) {
    return undefined;
  }

  return {
    cert: options.cert,
    key: options.key,
    ca: options.ca,
  };
}

/**
 * Build bridge configuration from CLI options and config file
 */
function buildBridgeConfig(
  options: StartCommandOptions,
  globalOptions: GlobalOptions
): BridgeConfig {
  // Load config file first
  const fileConfig = loadConfigSync(globalOptions.config);

  // CLI options override everything
  const cliConfig: Partial<BridgeConfig> = {};

  // Build TLS config from CLI options
  const cliTlsConfig = buildTLSConfig(options);

  // Build auth config from CLI options
  const cliAuthConfig = createAuthConfigFromOptions({
    authToken: options.authToken,
    authPassword: options.authPassword,
    authIp: options.authIp,
    authRequireAll: options.authRequireAll,
  });

  if (options.port) {
    cliConfig.listen = {
      ...cliConfig.listen,
      port: parseInt(options.port, 10),
      host: options.host ?? '0.0.0.0',
    };
  }

  if (options.host && !cliConfig.listen) {
    cliConfig.listen = {
      port: fileConfig.listen.port,
      host: options.host,
    };
  }

  if (options.connect) {
    cliConfig.connect = {
      url: options.connect,
    };
  }

  // Determine mode based on configuration
  // If connecting to a remote, we're a client; otherwise we're a host
  const hasConnect = cliConfig.connect || fileConfig.connect;
  const mode: BridgeMode = hasConnect ? 'client' : 'host';

  // Merge TLS config: CLI > file config
  const listenTls = cliTlsConfig ?? fileConfig.listen?.tls;
  const connectTls = cliTlsConfig ?? fileConfig.connect?.tls;

  // Merge auth config: CLI > file config
  const listenAuth = cliAuthConfig.type !== 'none' ? cliAuthConfig : fileConfig.listen?.auth;
  const connectAuth = cliAuthConfig.type !== 'none' ? cliAuthConfig : fileConfig.connect?.auth;

  // Build final config with priority: CLI > file config > defaults
  const finalConfig: BridgeConfig = {
    mode: cliConfig.mode ?? fileConfig.mode ?? mode,
    instanceName: cliConfig.instanceName ?? fileConfig.instanceName ?? `bridge-${process.pid}`,
    listen: {
      port: cliConfig.listen?.port ?? fileConfig.listen.port,
      host: cliConfig.listen?.host ?? fileConfig.listen.host,
      tls: listenTls,
      auth: listenAuth,
    },
    taskTimeout: fileConfig.interaction.taskTimeout,
    contextSharing: {
      autoSync: fileConfig.contextSharing.autoSync,
      syncInterval: fileConfig.contextSharing.syncInterval,
    },
  };

  // Add connect config if present
  const connectUrl = cliConfig.connect?.url ?? fileConfig.connect?.url;
  if (connectUrl) {
    finalConfig.connect = {
      url: connectUrl,
      tls: connectTls,
      auth: connectAuth,
    };
  }

  return finalConfig;
}

/**
 * Start the bridge server
 */
async function startBridge(
  options: StartCommandOptions,
  globalOptions: GlobalOptions
): Promise<void> {
  // Check if already running (skip check if we're the daemon child)
  if (!process.env.CLAUDE_BRIDGE_DAEMON_CHILD) {
    const { running, pid } = isAlreadyRunning();
    if (running) {
      // If --launch-claude is set, just launch Claude Code and attach to existing bridge
      if (options.launchClaude) {
        const claudeArgs = options.claudeArgs || [];
        console.log(`Bridge already running (PID: ${pid}), launching Claude Code...`);
        if (claudeArgs.length > 0) {
          console.log(`  Claude args: ${claudeArgs.join(' ')}`);
        }
        const { spawnSync } = await import('child_process');
        const result = spawnSync('claude', claudeArgs, {
          stdio: 'inherit',
          shell: true,
        });
        process.exit(result.status ?? 0);
      }
      console.error(`Bridge is already running (PID: ${pid})`);
      process.exit(1);
    }
  }

  // Build configuration
  const config = buildBridgeConfig(options, globalOptions);

  // Validate TLS configuration
  if (config.listen?.tls && isTLSEnabled(config.listen.tls)) {
    const tlsValidation = validateTLSConfig(config.listen.tls);
    if (!tlsValidation.valid) {
      console.error('TLS configuration errors:');
      for (const error of tlsValidation.errors) {
        console.error(`  - ${error}`);
      }
      process.exit(1);
    }
    for (const warning of tlsValidation.warnings) {
      console.warn(`  Warning: ${warning}`);
    }
  }

  // Validate auth configuration
  if (config.listen?.auth && config.listen.auth.type !== 'none') {
    const authValidation = validateAuthConfig(config.listen.auth);
    if (!authValidation.valid) {
      console.error('Authentication configuration errors:');
      for (const error of authValidation.errors) {
        console.error(`  - ${error}`);
      }
      process.exit(1);
    }
    for (const warning of authValidation.warnings) {
      console.warn(`  Warning: ${warning}`);
    }
  }

  // Log startup info
  console.log('Starting Claude Code Bridge...');
  console.log(`  Instance: ${config.instanceName}`);
  console.log(`  Mode: ${config.mode}`);

  if (config.listen) {
    const protocol = isTLSEnabled(config.listen.tls) ? 'wss' : 'ws';
    console.log(`  Listening: ${protocol}://${config.listen.host}:${config.listen.port}`);

    if (isTLSEnabled(config.listen.tls)) {
      console.log('  TLS: enabled');
    }

    if (config.listen.auth && config.listen.auth.type !== 'none') {
      const authMethods: string[] = [];
      if (config.listen.auth.token) authMethods.push('token');
      if (config.listen.auth.password) authMethods.push('password');
      if (config.listen.auth.allowedIps?.length) authMethods.push('ip');
      console.log(`  Auth: ${authMethods.join(', ')}${config.listen.auth.requireAll ? ' (require all)' : ''}`);
    }
  }

  if (config.connect) {
    console.log(`  Connecting to: ${config.connect.url}`);
  }

  // Handle daemon mode - spawn detached child process
  if (options.daemon && !process.env.CLAUDE_BRIDGE_DAEMON_CHILD) {
    const logFile = path.join(os.homedir(), '.claude-bridge', 'bridge.log');
    ensureBridgeDir();

    // Build args for child process (exclude --daemon to prevent infinite loop)
    const args = process.argv.slice(2).filter(arg => arg !== '-d' && arg !== '--daemon');

    // Spawn detached child process
    const out = fs.openSync(logFile, 'a');
    const err = fs.openSync(logFile, 'a');

    const child = spawn(process.execPath, [process.argv[1], ...args], {
      detached: true,
      stdio: ['ignore', out, err],
      env: { ...process.env, CLAUDE_BRIDGE_DAEMON_CHILD: '1' },
    });

    child.unref();

    // Write child PID to file
    writePidFile(child.pid!);

    console.log(`  Running in background (PID: ${child.pid})`);
    console.log(`  Log file: ${logFile}`);
    console.log(`  Use 'claude-bridge status' to check status`);
    console.log(`  Use 'claude-bridge stop' to stop the bridge`);

    // Launch Claude Code if requested
    if (options.launchClaude) {
      const claudeArgs = options.claudeArgs || [];
      console.log('\nLaunching Claude Code...');
      if (claudeArgs.length > 0) {
        console.log(`  Claude args: ${claudeArgs.join(' ')}`);
      }

      // Give the daemon a moment to start
      await new Promise(resolve => setTimeout(resolve, 500));

      // Launch claude in the foreground (replaces this process)
      const { spawnSync } = await import('child_process');
      const result = spawnSync('claude', claudeArgs, {
        stdio: 'inherit',
        shell: true,
      });

      process.exit(result.status ?? 0);
    }

    // Parent exits immediately
    process.exit(0);
  }

  // Create and start bridge
  const bridge = new Bridge(config);

  // Set up graceful shutdown handling
  setupGracefulShutdown({
    cleanup: async () => {
      logger.info('Stopping bridge...');
      await bridge.stop();
      logger.info('Bridge stopped');
    },
    afterCleanup: process.env.CLAUDE_BRIDGE_DAEMON_CHILD ? removePidFile : undefined,
    verbose: true,
    timeout: 10000,
  });

  // Handle unhandled promise rejections
  handleUnhandledRejections({
    exit: false,
    logger: (msg, err) => logger.error({ error: err.message }, msg),
  });

  // Load config for handler patterns
  const fileConfig = loadConfigSync(globalOptions.config);

  try {
    await bridge.start();

    // Register handlers if --with-handlers is enabled
    if (options.withHandlers) {
      registerHandlers(bridge, {
        includePatterns: fileConfig.contextSharing.includePatterns,
        excludePatterns: fileConfig.contextSharing.excludePatterns,
      });
    }

    // Write PID file if running as daemon child (parent already wrote it, but update to confirm startup)
    if (process.env.CLAUDE_BRIDGE_DAEMON_CHILD) {
      writePidFile(process.pid);
    }

    console.log('Bridge started successfully.');
    console.log(`Connected peers: ${bridge.getPeerCount()}`);

    // Log connection info for users
    if (config.listen) {
      console.log(`\nTo connect from another bridge:`);
      console.log(`  claude-bridge connect ws://localhost:${config.listen.port}`);
    }

    // Keep the process running
    if (!process.env.CLAUDE_BRIDGE_DAEMON_CHILD) {
      console.log('\nPress Ctrl+C to stop.');
    }
  } catch (error) {
    logger.error({ error: (error as Error).message }, 'Failed to start bridge');
    console.error(`Failed to start bridge: ${(error as Error).message}`);
    if (process.env.CLAUDE_BRIDGE_DAEMON_CHILD) {
      removePidFile();
    }
    process.exit(1);
  }
}

/**
 * Collect repeated option values into an array
 */
function collect(value: string, previous: string[]): string[] {
  return previous.concat([value]);
}

/**
 * Create the start command
 */
export function createStartCommand(): Command {
  const command = new Command('start');

  command
    .description('Start the bridge server')
    .option('-p, --port <port>', 'Port to listen on (default: 8765)')
    .option('-h, --host <host>', 'Host to bind to (default: 0.0.0.0)')
    .option('-c, --connect <url>', 'URL to connect to on startup (e.g., ws://localhost:8765 or wss://...)')
    .option('-d, --daemon', 'Run in background')
    .option('--with-handlers', 'Enable file reading and task handling capabilities')
    .option('--launch-claude', 'Start bridge daemon and launch Claude Code')
    // TLS options
    .option('--cert <path>', 'Path to TLS certificate file')
    .option('--key <path>', 'Path to TLS private key file')
    .option('--ca <path>', 'Path to CA certificate file')
    // Auth options
    .option('--auth-token <token>', 'Require token authentication')
    .option('--auth-password <password>', 'Require password authentication')
    .option('--auth-ip <cidr>', 'Allow connections from IP/CIDR (repeatable)', collect, [])
    .option('--auth-require-all', 'Require ALL auth methods to pass (default: any)')
    .argument('[claude-args...]', 'Arguments to pass to Claude Code (use after --)')
    .action(async (claudeArgs: string[], options: StartCommandOptions) => {
      // Store claude args in options
      options.claudeArgs = claudeArgs;

      // --launch-claude implies --daemon
      if (options.launchClaude) {
        options.daemon = true;
      }
      // Get global options from parent command
      const globalOptions = command.parent?.opts() as GlobalOptions;
      await startBridge(options, globalOptions);
    });

  return command;
}

/**
 * Export the command for use in CLI
 */
export { createStartCommand as startCommand };
