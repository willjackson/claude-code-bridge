/**
 * Unit tests for Context Manager
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, unlinkSync, utimesSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  ContextManager,
  buildDirectoryTree,
  type ProjectSnapshot,
  type ContextDelta,
} from '../../../src/bridge/context.js';

describe('ContextManager', () => {
  let tempDir: string;

  beforeEach(() => {
    // Create a unique temp directory for each test
    tempDir = mkdtempSync(join(tmpdir(), 'context-test-'));
  });

  afterEach(() => {
    // Cleanup temp directory after each test
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('generateSnapshot', () => {
    it('should generate a snapshot with correct structure', async () => {
      // Create test files
      writeFileSync(join(tempDir, 'file1.ts'), 'const x = 1;');
      writeFileSync(join(tempDir, 'file2.ts'), 'const y = 2;');

      const manager = new ContextManager({
        rootPath: tempDir,
        includePatterns: ['**/*.ts'],
        excludePatterns: [],
      });

      const snapshot = await manager.generateSnapshot();

      expect(snapshot).toBeDefined();
      expect(snapshot.id).toBeDefined();
      expect(typeof snapshot.id).toBe('string');
      expect(snapshot.timestamp).toBeDefined();
      expect(typeof snapshot.timestamp).toBe('number');
      expect(snapshot.tree).toBeDefined();
      expect(snapshot.tree.type).toBe('directory');
      expect(snapshot.summary).toContain('files');
      expect(Array.isArray(snapshot.keyFiles)).toBe(true);
    });

    it('should respect include patterns', async () => {
      // Create test files
      writeFileSync(join(tempDir, 'file1.ts'), 'typescript file');
      writeFileSync(join(tempDir, 'file2.js'), 'javascript file');
      writeFileSync(join(tempDir, 'file3.txt'), 'text file');

      const manager = new ContextManager({
        rootPath: tempDir,
        includePatterns: ['**/*.ts'],
        excludePatterns: [],
      });

      const snapshot = await manager.generateSnapshot();

      // Only .ts files should be included
      expect(snapshot.summary).toContain('1 files');
    });

    it('should respect exclude patterns', async () => {
      // Create test files with subdirectory
      mkdirSync(join(tempDir, 'node_modules'), { recursive: true });
      writeFileSync(join(tempDir, 'file1.ts'), 'main file');
      writeFileSync(join(tempDir, 'node_modules', 'pkg.ts'), 'node module');

      const manager = new ContextManager({
        rootPath: tempDir,
        includePatterns: ['**/*.ts'],
        excludePatterns: ['node_modules/**'],
      });

      const snapshot = await manager.generateSnapshot();

      // node_modules should be excluded
      expect(snapshot.summary).toContain('1 files');
    });

    it('should identify key files', async () => {
      writeFileSync(join(tempDir, 'package.json'), '{}');
      writeFileSync(join(tempDir, 'index.ts'), 'export {}');
      writeFileSync(join(tempDir, 'README.md'), '# Readme');

      const manager = new ContextManager({
        rootPath: tempDir,
        includePatterns: [],
        excludePatterns: [],
      });

      const snapshot = await manager.generateSnapshot();

      expect(snapshot.keyFiles).toContain('package.json');
      expect(snapshot.keyFiles).toContain('index.ts');
      expect(snapshot.keyFiles).toContain('README.md');
    });
  });

  describe('getRelevantContext', () => {
    it('should return file chunks within token limit', async () => {
      // Create test files with content
      writeFileSync(join(tempDir, 'file1.ts'), 'const x = 1;');
      writeFileSync(join(tempDir, 'file2.ts'), 'const y = 2;');

      const manager = new ContextManager({
        rootPath: tempDir,
        includePatterns: ['**/*.ts'],
        excludePatterns: [],
      });

      const chunks = await manager.getRelevantContext('test task', 1000);

      expect(chunks.length).toBeGreaterThan(0);
      expect(chunks[0].path).toBeDefined();
      expect(chunks[0].content).toBeDefined();
      expect(chunks[0].language).toBe('typescript');
    });

    it('should respect token limit', async () => {
      // Create file with many tokens
      const longContent = 'const x = 1;\n'.repeat(1000);
      writeFileSync(join(tempDir, 'long.ts'), longContent);

      const manager = new ContextManager({
        rootPath: tempDir,
        includePatterns: ['**/*.ts'],
        excludePatterns: [],
      });

      // Request very small token limit
      const chunks = await manager.getRelevantContext('test task', 10);

      // Should truncate content
      expect(chunks.length).toBe(1);
      const totalContent = chunks.reduce((acc, c) => acc + c.content, '');
      expect(totalContent.length).toBeLessThan(longContent.length);
    });

    it('should rank files by task relevance', async () => {
      writeFileSync(join(tempDir, 'auth.ts'), 'authentication code');
      writeFileSync(join(tempDir, 'utils.ts'), 'utility code');
      writeFileSync(join(tempDir, 'login.ts'), 'login code');

      const manager = new ContextManager({
        rootPath: tempDir,
        includePatterns: ['**/*.ts'],
        excludePatterns: [],
      });

      const chunks = await manager.getRelevantContext('fix authentication bug', 10000);

      expect(chunks.length).toBe(3);
      // auth.ts should be ranked higher due to keyword match
      expect(chunks[0].path).toBe('auth.ts');
    });
  });

  describe('getDelta', () => {
    it('should detect added files', async () => {
      writeFileSync(join(tempDir, 'file1.ts'), 'original');

      const manager = new ContextManager({
        rootPath: tempDir,
        includePatterns: ['**/*.ts'],
        excludePatterns: [],
      });

      // Take initial snapshot
      const snapshot1 = await manager.generateSnapshot();

      // Add a new file
      writeFileSync(join(tempDir, 'file2.ts'), 'new file');

      // Get delta
      const delta = await manager.getDelta(snapshot1.id);

      expect(delta.fromSyncId).toBe(snapshot1.id);
      expect(delta.toSyncId).toBeDefined();
      expect(delta.changes.length).toBe(1);
      expect(delta.changes[0].action).toBe('added');
      expect(delta.changes[0].path).toBe('file2.ts');
    });

    it('should detect modified files', async () => {
      const filePath = join(tempDir, 'file1.ts');
      writeFileSync(filePath, 'original content');

      const manager = new ContextManager({
        rootPath: tempDir,
        includePatterns: ['**/*.ts'],
        excludePatterns: [],
      });

      // Take initial snapshot
      const snapshot1 = await manager.generateSnapshot();

      // Wait a bit to ensure mtime changes
      await new Promise(resolve => setTimeout(resolve, 50));

      // Modify the file
      writeFileSync(filePath, 'modified content');
      // Ensure mtime is updated
      const now = new Date();
      utimesSync(filePath, now, now);

      // Get delta
      const delta = await manager.getDelta(snapshot1.id);

      expect(delta.changes.length).toBe(1);
      expect(delta.changes[0].action).toBe('modified');
      expect(delta.changes[0].path).toBe('file1.ts');
      expect(delta.changes[0].diff).toContain('modified');
    });

    it('should detect deleted files', async () => {
      const filePath = join(tempDir, 'file1.ts');
      writeFileSync(filePath, 'to be deleted');

      const manager = new ContextManager({
        rootPath: tempDir,
        includePatterns: ['**/*.ts'],
        excludePatterns: [],
      });

      // Take initial snapshot
      const snapshot1 = await manager.generateSnapshot();

      // Delete the file
      unlinkSync(filePath);

      // Get delta
      const delta = await manager.getDelta(snapshot1.id);

      expect(delta.changes.length).toBe(1);
      expect(delta.changes[0].action).toBe('deleted');
      expect(delta.changes[0].path).toBe('file1.ts');
    });

    it('should throw error for unknown snapshot ID', async () => {
      const manager = new ContextManager({
        rootPath: tempDir,
        includePatterns: [],
        excludePatterns: [],
      });

      await expect(manager.getDelta('nonexistent-id')).rejects.toThrow(
        'Snapshot nonexistent-id not found'
      );
    });

    it('should detect multiple types of changes', async () => {
      const file1 = join(tempDir, 'file1.ts');
      const file2 = join(tempDir, 'file2.ts');
      writeFileSync(file1, 'file1 original');
      writeFileSync(file2, 'file2 original');

      const manager = new ContextManager({
        rootPath: tempDir,
        includePatterns: ['**/*.ts'],
        excludePatterns: [],
      });

      const snapshot1 = await manager.generateSnapshot();

      // Wait a bit
      await new Promise(resolve => setTimeout(resolve, 50));

      // Multiple changes
      writeFileSync(file1, 'file1 modified'); // modify
      utimesSync(file1, new Date(), new Date());
      unlinkSync(file2); // delete
      writeFileSync(join(tempDir, 'file3.ts'), 'new file'); // add

      const delta = await manager.getDelta(snapshot1.id);

      expect(delta.changes.length).toBe(3);

      const actions = delta.changes.map(c => c.action);
      expect(actions).toContain('added');
      expect(actions).toContain('modified');
      expect(actions).toContain('deleted');
    });
  });
});

describe('buildDirectoryTree', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'tree-test-'));
  });

  afterEach(() => {
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  it('should build tree with correct structure', () => {
    mkdirSync(join(tempDir, 'src'));
    writeFileSync(join(tempDir, 'src', 'index.ts'), '');
    writeFileSync(join(tempDir, 'package.json'), '{}');

    const tree = buildDirectoryTree(tempDir);

    expect(tree.type).toBe('directory');
    expect(tree.children).toBeDefined();
    expect(tree.children!.length).toBe(2);

    // Directories come first, sorted alphabetically
    expect(tree.children![0].name).toBe('src');
    expect(tree.children![0].type).toBe('directory');
    expect(tree.children![1].name).toBe('package.json');
    expect(tree.children![1].type).toBe('file');
  });

  it('should respect include patterns', () => {
    writeFileSync(join(tempDir, 'file.ts'), '');
    writeFileSync(join(tempDir, 'file.js'), '');

    const tree = buildDirectoryTree(tempDir, {
      includePatterns: ['*.ts'],
    });

    const files = tree.children!.filter(c => c.type === 'file');
    expect(files.length).toBe(1);
    expect(files[0].name).toBe('file.ts');
  });

  it('should respect exclude patterns', () => {
    mkdirSync(join(tempDir, 'node_modules'));
    writeFileSync(join(tempDir, 'node_modules', 'pkg.js'), '');
    writeFileSync(join(tempDir, 'src.ts'), '');

    const tree = buildDirectoryTree(tempDir, {
      excludePatterns: ['node_modules', 'node_modules/**'],
    });

    const names = tree.children!.map(c => c.name);
    expect(names).not.toContain('node_modules');
    expect(names).toContain('src.ts');
  });

  it('should respect maxDepth option', () => {
    mkdirSync(join(tempDir, 'a', 'b', 'c'), { recursive: true });
    writeFileSync(join(tempDir, 'a', 'b', 'c', 'deep.ts'), '');

    const tree = buildDirectoryTree(tempDir, { maxDepth: 2 });

    // Should traverse to depth 2, so a/b should be present but empty
    const aDir = tree.children!.find(c => c.name === 'a');
    expect(aDir).toBeDefined();
    expect(aDir!.children!.length).toBe(1);

    const bDir = aDir!.children!.find(c => c.name === 'b');
    expect(bDir).toBeDefined();
    // At depth 2, b's children should be empty
    expect(bDir!.children!.length).toBe(0);
  });
});
