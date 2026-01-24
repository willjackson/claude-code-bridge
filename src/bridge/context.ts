/**
 * Context Manager for Claude Code Bridge
 *
 * Handles project context management including:
 * - Project snapshot generation
 * - Relevant context extraction with token limits
 * - Delta synchronization between snapshots
 */

import { readdirSync, readFileSync, statSync, existsSync, lstatSync, realpathSync } from 'fs';
import { join, basename, relative, extname, resolve } from 'path';
import { v4 as uuidv4 } from 'uuid';
import { minimatch } from 'minimatch';
import type { DirectoryTree, FileChunk } from './protocol.js';
import { estimateTokens } from '../utils/tokens.js';

/**
 * Options for building a directory tree
 */
export interface BuildDirectoryTreeOptions {
  /** Glob patterns for files to include */
  includePatterns?: string[];
  /** Glob patterns for files to exclude */
  excludePatterns?: string[];
  /** Maximum depth for directory tree building (default: 10) */
  maxDepth?: number;
}

/**
 * Build a directory tree structure starting from a root path
 *
 * This standalone function creates a DirectoryTree representation
 * of the file system, respecting include/exclude patterns and depth limits.
 * Symlinks are handled safely to prevent infinite loops.
 *
 * @param rootPath The root path to start building from
 * @param options Configuration options
 * @returns DirectoryTree representation of the directory structure
 *
 * @example
 * ```typescript
 * const tree = buildDirectoryTree('/path/to/project', {
 *   includePatterns: ['src/**\/*.ts'],
 *   excludePatterns: ['node_modules/**'],
 *   maxDepth: 5
 * });
 * ```
 */
export function buildDirectoryTree(
  rootPath: string,
  options: BuildDirectoryTreeOptions = {}
): DirectoryTree {
  const includePatterns = options.includePatterns ?? [];
  const excludePatterns = options.excludePatterns ?? [];
  const maxDepth = options.maxDepth ?? 10;

  // Track visited real paths to prevent infinite loops from symlinks
  const visitedPaths = new Set<string>();

  function isIncluded(relativePath: string): boolean {
    if (includePatterns.length === 0) {
      return true;
    }
    return includePatterns.some(pattern => minimatch(relativePath, pattern));
  }

  function isExcluded(relativePath: string): boolean {
    return excludePatterns.some(pattern => minimatch(relativePath, pattern));
  }

  function shouldIncludeDirectory(relativePath: string): boolean {
    if (includePatterns.length === 0) {
      return true;
    }
    return includePatterns.some(pattern => {
      if (pattern.startsWith('**')) {
        return true;
      }
      const patternParts = pattern.split('/');
      const pathParts = relativePath.split('/');
      for (let i = 0; i < pathParts.length && i < patternParts.length; i++) {
        if (patternParts[i] === '**') {
          return true;
        }
        if (!minimatch(pathParts[i], patternParts[i])) {
          return false;
        }
      }
      return true;
    });
  }

  function buildTree(dirPath: string, depth: number): DirectoryTree {
    const name = basename(dirPath);
    const tree: DirectoryTree = {
      name,
      type: 'directory',
      children: [],
    };

    if (depth >= maxDepth) {
      return tree;
    }

    // Resolve symlinks and check for cycles
    try {
      const realPath = realpathSync(dirPath);
      if (visitedPaths.has(realPath)) {
        // Symlink cycle detected, return empty directory
        return tree;
      }
      visitedPaths.add(realPath);
    } catch {
      // Can't resolve path, skip it
      return tree;
    }

    try {
      const entries = readdirSync(dirPath, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = join(dirPath, entry.name);
        const relativePath = relative(rootPath, fullPath);

        // Check exclusions first
        if (isExcluded(relativePath)) {
          continue;
        }

        // Handle symlinks
        if (entry.isSymbolicLink()) {
          try {
            const stats = statSync(fullPath);
            if (stats.isDirectory()) {
              if (shouldIncludeDirectory(relativePath)) {
                tree.children!.push(buildTree(fullPath, depth + 1));
              }
            } else if (stats.isFile()) {
              if (isIncluded(relativePath)) {
                tree.children!.push({
                  name: entry.name,
                  type: 'file',
                });
              }
            }
          } catch {
            // Broken symlink, skip it
            continue;
          }
        } else if (entry.isDirectory()) {
          if (shouldIncludeDirectory(relativePath)) {
            tree.children!.push(buildTree(fullPath, depth + 1));
          }
        } else if (entry.isFile()) {
          if (isIncluded(relativePath)) {
            tree.children!.push({
              name: entry.name,
              type: 'file',
            });
          }
        }
      }

      // Sort children: directories first, then files, alphabetically
      tree.children!.sort((a, b) => {
        if (a.type !== b.type) {
          return a.type === 'directory' ? -1 : 1;
        }
        return a.name.localeCompare(b.name);
      });
    } catch {
      // Return empty directory if we can't read it
    }

    return tree;
  }

  return buildTree(rootPath, 0);
}

/**
 * Configuration options for ContextManager
 */
export interface ContextManagerOptions {
  /** Root path of the project to manage context for */
  rootPath: string;
  /** Glob patterns for files to include */
  includePatterns: string[];
  /** Glob patterns for files to exclude */
  excludePatterns: string[];
  /** Maximum depth for directory tree building (default: 10) */
  maxDepth?: number;
}

/**
 * Snapshot of the project state at a point in time
 */
export interface ProjectSnapshot {
  /** Unique identifier for this snapshot */
  id: string;
  /** Unix timestamp when snapshot was created */
  timestamp: number;
  /** Directory tree structure */
  tree: DirectoryTree;
  /** Summary of the project (file count, languages, etc.) */
  summary: string;
  /** List of key files identified in the project */
  keyFiles: string[];
}

/**
 * Represents a change to a file between snapshots
 */
export interface FileChange {
  /** Relative path of the file */
  path: string;
  /** Type of change detected */
  action: 'added' | 'modified' | 'deleted';
  /** Diff content for modified files */
  diff?: string;
}

/**
 * Delta between two snapshots
 */
export interface ContextDelta {
  /** ID of the source snapshot */
  fromSyncId: string;
  /** ID of the target snapshot */
  toSyncId: string;
  /** List of file changes */
  changes: FileChange[];
}

/**
 * Internal file state for delta comparison
 */
interface FileState {
  /** Relative path of the file */
  path: string;
  /** Modification time in milliseconds */
  mtime: number;
  /** File size in bytes */
  size: number;
}

/**
 * Internal snapshot state for delta comparison
 */
interface SnapshotState {
  /** Snapshot ID */
  id: string;
  /** Map of file path to FileState */
  files: Map<string, FileState>;
}

/**
 * ContextManager handles project context extraction and management
 */
export class ContextManager {
  private readonly rootPath: string;
  private readonly includePatterns: string[];
  private readonly excludePatterns: string[];
  private readonly maxDepth: number;

  /** Stored snapshots for delta comparison */
  private readonly snapshotStates: Map<string, SnapshotState> = new Map();

  /**
   * Create a new ContextManager
   * @param options Configuration options
   */
  constructor(options: ContextManagerOptions) {
    this.rootPath = options.rootPath;
    this.includePatterns = options.includePatterns;
    this.excludePatterns = options.excludePatterns;
    this.maxDepth = options.maxDepth ?? 10;
  }

  /**
   * Generate a complete snapshot of the current project state
   * @returns ProjectSnapshot with tree structure, summary, and key files
   */
  async generateSnapshot(): Promise<ProjectSnapshot> {
    const tree = buildDirectoryTree(this.rootPath, {
      includePatterns: this.includePatterns,
      excludePatterns: this.excludePatterns,
      maxDepth: this.maxDepth,
    });
    const files = this.collectMatchingFiles(this.rootPath);
    const keyFiles = this.identifyKeyFiles(files);
    const summary = this.generateSummary(files);

    const snapshotId = uuidv4();

    // Store file states for delta comparison
    const fileStates = new Map<string, FileState>();
    for (const file of files) {
      try {
        const stats = statSync(file);
        const relativePath = relative(this.rootPath, file);
        fileStates.set(relativePath, {
          path: relativePath,
          mtime: stats.mtimeMs,
          size: stats.size,
        });
      } catch {
        // Skip files we can't stat
      }
    }

    this.snapshotStates.set(snapshotId, {
      id: snapshotId,
      files: fileStates,
    });

    return {
      id: snapshotId,
      timestamp: Date.now(),
      tree,
      summary,
      keyFiles,
    };
  }

  /**
   * Get changes since the last snapshot
   *
   * Compares the current file system state with a previously stored snapshot
   * to detect added, modified, and deleted files.
   *
   * @param lastSyncId ID of the last snapshot to compare against
   * @returns ContextDelta with changes since the last sync
   * @throws Error if lastSyncId is not found
   */
  async getDelta(lastSyncId: string): Promise<ContextDelta> {
    const lastState = this.snapshotStates.get(lastSyncId);
    if (!lastState) {
      throw new Error(`Snapshot ${lastSyncId} not found`);
    }

    // Generate a new snapshot to compare against
    const currentSnapshot = await this.generateSnapshot();
    const currentState = this.snapshotStates.get(currentSnapshot.id)!;

    const changes: FileChange[] = [];

    // Check for added and modified files
    for (const [path, currentFile] of currentState.files) {
      const lastFile = lastState.files.get(path);

      if (!lastFile) {
        // File was added
        changes.push({
          path,
          action: 'added',
        });
      } else if (currentFile.mtime !== lastFile.mtime || currentFile.size !== lastFile.size) {
        // File was modified
        const diff = await this.generateFileDiff(path);
        changes.push({
          path,
          action: 'modified',
          diff,
        });
      }
    }

    // Check for deleted files
    for (const path of lastState.files.keys()) {
      if (!currentState.files.has(path)) {
        changes.push({
          path,
          action: 'deleted',
        });
      }
    }

    return {
      fromSyncId: lastSyncId,
      toSyncId: currentSnapshot.id,
      changes,
    };
  }

  /**
   * Generate a simple diff for a modified file
   * Returns the new content (simplified diff for now)
   */
  private async generateFileDiff(relativePath: string): Promise<string> {
    try {
      const fullPath = join(this.rootPath, relativePath);
      const content = readFileSync(fullPath, 'utf-8');
      // Simplified diff: return first 1000 chars of new content
      // A more sophisticated implementation could use a proper diff algorithm
      return content.length > 1000 ? content.slice(0, 1000) + '...' : content;
    } catch {
      return '';
    }
  }

  /**
   * Get relevant file chunks based on a task description, respecting token limits
   * @param task Description of the task to get context for
   * @param maxTokens Maximum tokens for the returned context
   * @returns Array of FileChunk objects within the token limit
   */
  async getRelevantContext(task: string, maxTokens: number): Promise<FileChunk[]> {
    const files = this.collectMatchingFiles(this.rootPath);
    const rankedFiles = this.rankFilesForTask(files, task);
    const chunks: FileChunk[] = [];
    let currentTokens = 0;

    for (const filePath of rankedFiles) {
      try {
        const content = readFileSync(filePath, 'utf-8');
        const fileTokens = estimateTokens(content);

        // Check if we can fit this file
        if (currentTokens + fileTokens <= maxTokens) {
          chunks.push({
            path: relative(this.rootPath, filePath),
            content,
            language: this.getLanguage(filePath),
          });
          currentTokens += fileTokens;
        } else if (chunks.length === 0) {
          // If first file and it doesn't fit, truncate it
          const remainingTokens = maxTokens - currentTokens;
          const truncatedContent = this.truncateContent(content, remainingTokens);
          if (truncatedContent) {
            chunks.push({
              path: relative(this.rootPath, filePath),
              content: truncatedContent,
              language: this.getLanguage(filePath),
            });
            break;
          }
        }

        // Stop if we've reached the limit
        if (currentTokens >= maxTokens) {
          break;
        }
      } catch {
        // Skip files that can't be read
        continue;
      }
    }

    return chunks;
  }

  /**
   * Collect all files matching include patterns and not matching exclude patterns
   */
  private collectMatchingFiles(dirPath: string): string[] {
    const files: string[] = [];
    this.collectFilesRecursive(dirPath, files, 0);
    return files;
  }

  private collectFilesRecursive(dirPath: string, files: string[], depth: number): void {
    if (depth >= this.maxDepth) {
      return;
    }

    try {
      const entries = readdirSync(dirPath, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = join(dirPath, entry.name);
        const relativePath = relative(this.rootPath, fullPath);

        if (this.isExcluded(relativePath)) {
          continue;
        }

        if (entry.isDirectory()) {
          this.collectFilesRecursive(fullPath, files, depth + 1);
        } else if (entry.isFile() && this.isIncluded(relativePath)) {
          files.push(fullPath);
        }
      }
    } catch {
      // Skip directories we can't read
    }
  }

  /**
   * Check if a path matches any include pattern
   */
  private isIncluded(relativePath: string): boolean {
    if (this.includePatterns.length === 0) {
      return true;
    }
    return this.includePatterns.some(pattern => minimatch(relativePath, pattern));
  }

  /**
   * Check if a path matches any exclude pattern
   */
  private isExcluded(relativePath: string): boolean {
    return this.excludePatterns.some(pattern => minimatch(relativePath, pattern));
  }

  /**
   * Check if a directory should be traversed based on include patterns
   */
  private shouldIncludeDirectory(relativePath: string): boolean {
    // Always traverse directories if we might find matching files inside
    // This is a simplified check - we traverse if any include pattern
    // could potentially match files in this directory
    if (this.includePatterns.length === 0) {
      return true;
    }

    return this.includePatterns.some(pattern => {
      // Check if this directory is part of any include pattern path
      const patternParts = pattern.split('/');
      const pathParts = relativePath.split('/');

      // If pattern starts with **, always include
      if (pattern.startsWith('**')) {
        return true;
      }

      // Check if path could be a prefix of the pattern
      for (let i = 0; i < pathParts.length && i < patternParts.length; i++) {
        if (patternParts[i] === '**') {
          return true;
        }
        if (!minimatch(pathParts[i], patternParts[i])) {
          return false;
        }
      }
      return true;
    });
  }

  /**
   * Identify key files in the project (config files, entry points, etc.)
   */
  private identifyKeyFiles(files: string[]): string[] {
    const keyFileNames = [
      'package.json',
      'tsconfig.json',
      'index.ts',
      'index.js',
      'main.ts',
      'main.js',
      'app.ts',
      'app.js',
      'README.md',
      'CLAUDE.md',
    ];

    const keyFiles: string[] = [];

    for (const file of files) {
      const fileName = basename(file);
      if (keyFileNames.includes(fileName)) {
        keyFiles.push(relative(this.rootPath, file));
      }
    }

    return keyFiles;
  }

  /**
   * Generate a summary string describing the project
   */
  private generateSummary(files: string[]): string {
    const extensions = new Map<string, number>();

    for (const file of files) {
      const ext = extname(file) || '(no extension)';
      extensions.set(ext, (extensions.get(ext) || 0) + 1);
    }

    const extSummary = Array.from(extensions.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([ext, count]) => `${ext}: ${count}`)
      .join(', ');

    return `Project contains ${files.length} files. Top extensions: ${extSummary}`;
  }

  /**
   * Rank files by relevance to a task description
   * Files with matching keywords are ranked higher
   */
  private rankFilesForTask(files: string[], task: string): string[] {
    const taskLower = task.toLowerCase();
    const keywords = taskLower.split(/\s+/).filter(w => w.length > 2);

    const scored = files.map(file => {
      const relativePath = relative(this.rootPath, file).toLowerCase();
      let score = 0;

      // Score based on keyword matches in file path
      for (const keyword of keywords) {
        if (relativePath.includes(keyword)) {
          score += 10;
        }
      }

      // Boost key files
      const fileName = basename(file);
      if (['index.ts', 'index.js', 'main.ts', 'main.js'].includes(fileName)) {
        score += 5;
      }
      if (fileName === 'package.json') {
        score += 3;
      }

      return { file, score };
    });

    // Sort by score descending, then by path
    scored.sort((a, b) => {
      if (a.score !== b.score) {
        return b.score - a.score;
      }
      return a.file.localeCompare(b.file);
    });

    return scored.map(s => s.file);
  }

  /**
   * Get programming language from file extension
   */
  private getLanguage(filePath: string): string {
    const ext = extname(filePath).toLowerCase();
    const languageMap: Record<string, string> = {
      '.ts': 'typescript',
      '.tsx': 'typescript',
      '.js': 'javascript',
      '.jsx': 'javascript',
      '.py': 'python',
      '.rb': 'ruby',
      '.go': 'go',
      '.rs': 'rust',
      '.java': 'java',
      '.c': 'c',
      '.cpp': 'cpp',
      '.h': 'c',
      '.hpp': 'cpp',
      '.cs': 'csharp',
      '.php': 'php',
      '.swift': 'swift',
      '.kt': 'kotlin',
      '.scala': 'scala',
      '.md': 'markdown',
      '.json': 'json',
      '.yaml': 'yaml',
      '.yml': 'yaml',
      '.xml': 'xml',
      '.html': 'html',
      '.css': 'css',
      '.scss': 'scss',
      '.less': 'less',
      '.sql': 'sql',
      '.sh': 'bash',
      '.bash': 'bash',
      '.zsh': 'zsh',
    };

    return languageMap[ext] || 'text';
  }

  /**
   * Truncate file content to fit within a token limit
   */
  private truncateContent(content: string, maxTokens: number): string {
    const lines = content.split('\n');
    const result: string[] = [];
    let currentTokens = 0;

    for (const line of lines) {
      const lineTokens = estimateTokens(line);
      if (currentTokens + lineTokens <= maxTokens) {
        result.push(line);
        currentTokens += lineTokens;
      } else {
        break;
      }
    }

    return result.join('\n');
  }
}
