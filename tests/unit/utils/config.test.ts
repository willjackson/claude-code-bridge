import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  loadConfig,
  loadConfigSync,
  mergeConfig,
  DEFAULT_CONFIG,
} from '../../../src/utils/config';

// Mock the fs module
vi.mock('fs');

describe('Config', () => {
  const originalCwd = process.cwd;
  let mockCwd: string;

  beforeEach(() => {
    vi.resetAllMocks();
    mockCwd = '/test/project';
    process.cwd = vi.fn().mockReturnValue(mockCwd);
  });

  afterEach(() => {
    process.cwd = originalCwd;
  });

  describe('DEFAULT_CONFIG', () => {
    it('should have correct default listen settings', () => {
      expect(DEFAULT_CONFIG.listen.port).toBe(8765);
      expect(DEFAULT_CONFIG.listen.host).toBe('0.0.0.0');
    });

    it('should have correct default contextSharing settings', () => {
      expect(DEFAULT_CONFIG.contextSharing.autoSync).toBe(true);
      expect(DEFAULT_CONFIG.contextSharing.syncInterval).toBe(5000);
      expect(DEFAULT_CONFIG.contextSharing.maxChunkTokens).toBe(4000);
      expect(DEFAULT_CONFIG.contextSharing.includePatterns).toContain('src/**/*.ts');
      expect(DEFAULT_CONFIG.contextSharing.excludePatterns).toContain('node_modules/**');
    });

    it('should have correct default interaction settings', () => {
      expect(DEFAULT_CONFIG.interaction.requireConfirmation).toBe(false);
      expect(DEFAULT_CONFIG.interaction.notifyOnActivity).toBe(true);
      expect(DEFAULT_CONFIG.interaction.taskTimeout).toBe(300000);
    });
  });

  describe('mergeConfig', () => {
    it('should return defaults when given empty object', () => {
      const merged = mergeConfig({});
      expect(merged.listen.port).toBe(DEFAULT_CONFIG.listen.port);
      expect(merged.listen.host).toBe(DEFAULT_CONFIG.listen.host);
      expect(merged.contextSharing.maxChunkTokens).toBe(
        DEFAULT_CONFIG.contextSharing.maxChunkTokens
      );
    });

    it('should merge partial listen config with defaults', () => {
      const partial = { listen: { port: 9000 } };
      const merged = mergeConfig(partial);
      expect(merged.listen.port).toBe(9000);
      expect(merged.listen.host).toBe(DEFAULT_CONFIG.listen.host);
    });

    it('should merge partial contextSharing config with defaults', () => {
      const partial = {
        contextSharing: {
          maxChunkTokens: 8000,
          autoSync: false,
        },
      };
      const merged = mergeConfig(partial);
      expect(merged.contextSharing.maxChunkTokens).toBe(8000);
      expect(merged.contextSharing.autoSync).toBe(false);
      expect(merged.contextSharing.syncInterval).toBe(
        DEFAULT_CONFIG.contextSharing.syncInterval
      );
    });

    it('should merge partial interaction config with defaults', () => {
      const partial = {
        interaction: {
          requireConfirmation: true,
        },
      };
      const merged = mergeConfig(partial);
      expect(merged.interaction.requireConfirmation).toBe(true);
      expect(merged.interaction.notifyOnActivity).toBe(
        DEFAULT_CONFIG.interaction.notifyOnActivity
      );
    });

    it('should include connect config when provided', () => {
      const partial = {
        connect: {
          url: 'ws://localhost:8765',
          hostGateway: true,
        },
      };
      const merged = mergeConfig(partial);
      expect(merged.connect?.url).toBe('ws://localhost:8765');
      expect(merged.connect?.hostGateway).toBe(true);
    });

    it('should leave connect undefined when not provided', () => {
      const merged = mergeConfig({});
      expect(merged.connect).toBeUndefined();
    });

    it('should merge instanceName and mode', () => {
      const partial = {
        instanceName: 'my-bridge',
        mode: 'peer' as const,
      };
      const merged = mergeConfig(partial);
      expect(merged.instanceName).toBe('my-bridge');
      expect(merged.mode).toBe('peer');
    });
  });

  describe('loadConfig', () => {
    it('should return default config when no file exists', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);

      const config = await loadConfig();

      expect(config).toEqual(DEFAULT_CONFIG);
    });

    it('should return default config when explicit path does not exist', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);

      const config = await loadConfig('/nonexistent/path');

      expect(config).toEqual(DEFAULT_CONFIG);
    });

    it('should load config from explicit path', async () => {
      const configContent = `
listen:
  port: 9000
  host: "127.0.0.1"
`;
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(configContent);

      const config = await loadConfig('/custom/config.yml');

      expect(config.listen.port).toBe(9000);
      expect(config.listen.host).toBe('127.0.0.1');
      expect(config.contextSharing.maxChunkTokens).toBe(
        DEFAULT_CONFIG.contextSharing.maxChunkTokens
      );
    });

    it('should search default paths when no explicit path given', async () => {
      const homeDir = os.homedir();

      // First path doesn't exist, second one does
      vi.mocked(fs.existsSync).mockImplementation((p) => {
        return p === path.join(mockCwd, '.claude-bridge.yml');
      });

      const configContent = `
listen:
  port: 8888
`;
      vi.mocked(fs.readFileSync).mockReturnValue(configContent);

      const config = await loadConfig();

      expect(config.listen.port).toBe(8888);
    });

    it('should return defaults when config file is empty', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue('');

      const config = await loadConfig('/some/path');

      // Empty YAML parses to null/undefined, so mergeConfig treats it as empty object
      expect(config.listen.port).toBe(DEFAULT_CONFIG.listen.port);
    });

    it('should return defaults when config file has invalid YAML', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockImplementation(() => {
        throw new Error('Invalid YAML');
      });

      const config = await loadConfig('/some/path');

      expect(config).toEqual(DEFAULT_CONFIG);
    });
  });

  describe('loadConfigSync', () => {
    it('should return default config when no file exists', () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);

      const config = loadConfigSync();

      expect(config).toEqual(DEFAULT_CONFIG);
    });

    it('should return default config when explicit path does not exist', () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);

      const config = loadConfigSync('/nonexistent/path');

      expect(config).toEqual(DEFAULT_CONFIG);
    });

    it('should load config from explicit path', () => {
      const configContent = `
listen:
  port: 7777
contextSharing:
  autoSync: false
`;
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(configContent);

      const config = loadConfigSync('/custom/config.yml');

      expect(config.listen.port).toBe(7777);
      expect(config.contextSharing.autoSync).toBe(false);
    });

    it('should search default paths when no explicit path given', () => {
      vi.mocked(fs.existsSync).mockImplementation((p) => {
        return p === path.join(mockCwd, '.claude-bridge.yaml');
      });

      const configContent = `
interaction:
  taskTimeout: 60000
`;
      vi.mocked(fs.readFileSync).mockReturnValue(configContent);

      const config = loadConfigSync();

      expect(config.interaction.taskTimeout).toBe(60000);
    });

    it('should return defaults when config file parsing fails', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockImplementation(() => {
        throw new Error('Read error');
      });

      const config = loadConfigSync('/some/path');

      expect(config).toEqual(DEFAULT_CONFIG);
    });
  });

  describe('config file search order', () => {
    it('should prefer project-local .claude-bridge.yml over home config', () => {
      const homeDir = os.homedir();
      const homePath = path.join(homeDir, '.claude-bridge', 'config.yml');
      const projectPath = path.join(mockCwd, '.claude-bridge.yml');

      // Both files exist
      vi.mocked(fs.existsSync).mockImplementation((p) => {
        return p === projectPath || p === homePath;
      });

      vi.mocked(fs.readFileSync).mockImplementation((p) => {
        if (p === projectPath) {
          return 'listen:\n  port: 1111';
        }
        return 'listen:\n  port: 2222';
      });

      const config = loadConfigSync();

      // Project config should be loaded (port 1111)
      expect(config.listen.port).toBe(1111);
    });
  });
});
