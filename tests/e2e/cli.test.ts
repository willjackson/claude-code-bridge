/**
 * End-to-end tests for CLI commands
 *
 * These tests spawn actual CLI processes and verify their output.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { execSync, spawnSync } from 'child_process';
import * as path from 'path';

// Path to the built CLI
const CLI_PATH = path.join(process.cwd(), 'dist', 'cli.js');

/**
 * Execute CLI command synchronously and return output
 * Uses spawnSync for better control over process termination
 */
function execCli(args: string): { stdout: string; stderr: string; status: number | null } {
  const result = spawnSync('node', [CLI_PATH, ...args.split(' ')].filter(Boolean), {
    encoding: 'utf-8',
    timeout: 3000,
  });
  return {
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    status: result.status,
  };
}

describe('CLI E2E', () => {
  beforeAll(() => {
    // Ensure the CLI is built
    try {
      execSync('npm run build', { stdio: 'pipe', timeout: 30000 });
    } catch {
      // Build may already be done
    }
  });

  describe('--help', () => {
    it('should show help with command list', () => {
      const result = execCli('--help');
      const output = result.stdout;
      expect(output).toContain('claude-bridge');
      expect(output).toContain('start');
      expect(output).toContain('stop');
      expect(output).toContain('status');
      expect(output).toContain('connect');
      expect(output).toContain('info');
    });

    it('should show global options', () => {
      const result = execCli('--help');
      const output = result.stdout;
      expect(output).toContain('-v, --verbose');
      expect(output).toContain('--config');
    });
  });

  describe('--version', () => {
    it('should show version number', () => {
      const result = execCli('--version');
      expect(result.stdout).toMatch(/\d+\.\d+\.\d+/);
    });
  });

  describe('info command', () => {
    it('should show system information', () => {
      const result = execCli('info');
      const output = result.stdout;
      expect(output).toContain('System');
      expect(output).toContain('Node Version:');
      expect(output).toContain('Platform:');
    });

    it('should show network information', () => {
      const result = execCli('info');
      const output = result.stdout;
      expect(output).toContain('Network');
    });

    it('should show configuration', () => {
      const result = execCli('info');
      const output = result.stdout;
      expect(output).toContain('Configuration');
      expect(output).toContain('Config File:');
    });

    it('should show working directory', () => {
      const result = execCli('info');
      const output = result.stdout;
      expect(output).toContain('Working Directory:');
    });
  });

  describe('status command', () => {
    it('should show bridge is not running when no PID file', () => {
      const result = execCli('status');
      const output = result.stdout;
      expect(output).toContain('Status');
      expect(output.toLowerCase()).toContain('stop');
    });
  });

  describe('connect command', () => {
    it('should require URL argument', () => {
      const result = execCli('connect');
      const output = result.stdout + result.stderr;
      // Commander shows "missing required argument" or similar
      expect(output.toLowerCase()).toMatch(/argument|required|missing/);
    });
  });

  describe('start command help', () => {
    it('should show start command options', () => {
      const result = execCli('start --help');
      const output = result.stdout;
      expect(output).toContain('-p, --port');
      expect(output).toContain('-c, --connect');
      expect(output).toContain('-d, --daemon');
      expect(output).toContain('--with-handlers');
    });
  });

  describe('stop command', () => {
    it('should report bridge not running when no PID file', () => {
      const result = execCli('stop');
      const output = result.stdout;
      expect(output.toLowerCase()).toContain('not running');
    });
  });
});
