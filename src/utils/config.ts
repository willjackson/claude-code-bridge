import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { parse as parseYaml } from 'yaml';

/**
 * Configuration for the bridge's listening socket
 */
export interface ListenConfig {
  port: number;
  host: string;
}

/**
 * Configuration for connecting to a remote bridge
 */
export interface ConnectConfig {
  url?: string;
  hostGateway?: boolean;
  port?: number;
}

/**
 * Configuration for context sharing behavior
 */
export interface ContextSharingConfig {
  autoSync: boolean;
  syncInterval: number;
  maxChunkTokens: number;
  includePatterns: string[];
  excludePatterns: string[];
}

/**
 * Configuration for interaction behavior
 */
export interface InteractionConfig {
  requireConfirmation: boolean;
  notifyOnActivity: boolean;
  taskTimeout: number;
}

/**
 * Full bridge configuration
 */
export interface BridgeConfig {
  instanceName?: string;
  mode?: 'host' | 'client' | 'peer';
  listen: ListenConfig;
  connect?: ConnectConfig;
  contextSharing: ContextSharingConfig;
  interaction: InteractionConfig;
}

/**
 * Default configuration values
 */
export const DEFAULT_CONFIG: BridgeConfig = {
  listen: {
    port: 8765,
    host: '0.0.0.0',
  },
  contextSharing: {
    autoSync: true,
    syncInterval: 5000,
    maxChunkTokens: 4000,
    includePatterns: ['src/**/*.ts', 'src/**/*.tsx', '*.json'],
    excludePatterns: ['node_modules/**', 'dist/**', '.git/**'],
  },
  interaction: {
    requireConfirmation: false,
    notifyOnActivity: true,
    taskTimeout: 300000, // 5 minutes
  },
};

/**
 * Deep merges a partial config with the default config
 *
 * @param partial - Partial configuration to merge
 * @returns Complete configuration with defaults for missing values
 */
export function mergeConfig(partial: Partial<BridgeConfig>): BridgeConfig {
  return {
    ...DEFAULT_CONFIG,
    ...partial,
    listen: {
      ...DEFAULT_CONFIG.listen,
      ...(partial.listen ?? {}),
    },
    connect: partial.connect
      ? {
          ...partial.connect,
        }
      : undefined,
    contextSharing: {
      ...DEFAULT_CONFIG.contextSharing,
      ...(partial.contextSharing ?? {}),
    },
    interaction: {
      ...DEFAULT_CONFIG.interaction,
      ...(partial.interaction ?? {}),
    },
  };
}

/**
 * Attempts to read and parse a YAML config file
 *
 * @param filePath - Path to the config file
 * @returns Parsed config or null if file doesn't exist
 */
function readConfigFile(filePath: string): Partial<BridgeConfig> | null {
  try {
    if (!fs.existsSync(filePath)) {
      return null;
    }
    const content = fs.readFileSync(filePath, 'utf-8');
    const parsed = parseYaml(content);
    return parsed as Partial<BridgeConfig>;
  } catch {
    // Return null if file can't be read or parsed
    return null;
  }
}

/**
 * Gets the default config file paths to search
 *
 * @returns Array of config file paths in priority order
 */
function getDefaultConfigPaths(): string[] {
  const homeDir = os.homedir();
  const cwd = process.cwd();

  return [
    // Project-local config takes priority
    path.join(cwd, '.claude-bridge.yml'),
    path.join(cwd, '.claude-bridge.yaml'),
    // User home config as fallback
    path.join(homeDir, '.claude-bridge', 'config.yml'),
    path.join(homeDir, '.claude-bridge', 'config.yaml'),
  ];
}

/**
 * Loads configuration from file(s) and merges with defaults
 *
 * Searches for config files in the following order:
 * 1. Explicit path (if provided)
 * 2. .claude-bridge.yml in current working directory
 * 3. ~/.claude-bridge/config.yml
 *
 * @param configPath - Optional explicit path to config file
 * @returns Complete configuration with defaults for missing values
 *
 * @example
 * ```typescript
 * // Load from default locations
 * const config = await loadConfig();
 *
 * // Load from specific path
 * const config = await loadConfig('/path/to/config.yml');
 * ```
 */
export async function loadConfig(configPath?: string): Promise<BridgeConfig> {
  // If explicit path provided, try to load it
  if (configPath) {
    const parsed = readConfigFile(configPath);
    if (parsed) {
      return mergeConfig(parsed);
    }
    // If explicit path doesn't exist, return defaults
    return { ...DEFAULT_CONFIG };
  }

  // Search default paths
  const searchPaths = getDefaultConfigPaths();

  for (const searchPath of searchPaths) {
    const parsed = readConfigFile(searchPath);
    if (parsed) {
      return mergeConfig(parsed);
    }
  }

  // No config file found, return defaults
  return { ...DEFAULT_CONFIG };
}

/**
 * Synchronous version of loadConfig for simpler usage patterns
 *
 * @param configPath - Optional explicit path to config file
 * @returns Complete configuration with defaults for missing values
 */
export function loadConfigSync(configPath?: string): BridgeConfig {
  // If explicit path provided, try to load it
  if (configPath) {
    const parsed = readConfigFile(configPath);
    if (parsed) {
      return mergeConfig(parsed);
    }
    // If explicit path doesn't exist, return defaults
    return { ...DEFAULT_CONFIG };
  }

  // Search default paths
  const searchPaths = getDefaultConfigPaths();

  for (const searchPath of searchPaths) {
    const parsed = readConfigFile(searchPath);
    if (parsed) {
      return mergeConfig(parsed);
    }
  }

  // No config file found, return defaults
  return { ...DEFAULT_CONFIG };
}
