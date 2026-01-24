/**
 * MCP Tool definitions for Claude Code Bridge
 * Defines input schemas and handler functions for all bridge tools
 */

import { z } from 'zod';
import type { Bridge } from '../bridge/core.js';
import type { TaskResult } from '../bridge/protocol.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('mcp:tools');

// ============================================================================
// Tool Input Schemas
// ============================================================================

export const ReadFileInputSchema = z.object({
  path: z.string().describe('Path to the file to read'),
});

export const WriteFileInputSchema = z.object({
  path: z.string().describe('Path to the file to write'),
  content: z.string().describe('Content to write to the file'),
});

export const DeleteFileInputSchema = z.object({
  path: z.string().describe('Path to the file to delete'),
});

export const ListDirectoryInputSchema = z.object({
  path: z.string().describe('Path to the directory to list'),
});

export const DelegateTaskInputSchema = z.object({
  description: z.string().describe('Description of the task to delegate'),
  scope: z.enum(['execute', 'analyze', 'suggest']).describe('Task scope'),
  data: z.record(z.unknown()).optional().describe('Additional task data'),
});

export const RequestContextInputSchema = z.object({
  query: z.string().describe('Query describing what files to retrieve'),
});

// ============================================================================
// Tool Definitions
// ============================================================================

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: z.ZodType<unknown>;
}

export const TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: 'bridge_read_file',
    description: 'Read a file from the remote connected instance',
    inputSchema: ReadFileInputSchema,
  },
  {
    name: 'bridge_write_file',
    description: 'Write a file to the remote connected instance',
    inputSchema: WriteFileInputSchema,
  },
  {
    name: 'bridge_delete_file',
    description: 'Delete a file on the remote connected instance',
    inputSchema: DeleteFileInputSchema,
  },
  {
    name: 'bridge_list_directory',
    description: 'List files and folders in a directory on the remote connected instance',
    inputSchema: ListDirectoryInputSchema,
  },
  {
    name: 'bridge_delegate_task',
    description: 'Delegate a custom task to the remote connected instance',
    inputSchema: DelegateTaskInputSchema,
  },
  {
    name: 'bridge_request_context',
    description: 'Request files matching a query from the remote connected instance',
    inputSchema: RequestContextInputSchema,
  },
  {
    name: 'bridge_status',
    description: 'Get bridge status and connected peers',
    inputSchema: z.object({}),
  },
];

// ============================================================================
// Tool Content Response Types
// ============================================================================

export interface TextContent {
  type: 'text';
  text: string;
}

export interface ToolResponse {
  content: TextContent[];
  isError?: boolean;
}

// ============================================================================
// Tool Handlers
// ============================================================================

/**
 * Create tool handlers bound to a bridge instance
 */
export function createToolHandlers(bridge: Bridge) {
  const handlers: Record<string, (args: Record<string, unknown>) => Promise<ToolResponse>> = {};

  /**
   * Helper to create error response
   */
  function errorResponse(message: string): ToolResponse {
    return {
      content: [{ type: 'text', text: `Error: ${message}` }],
      isError: true,
    };
  }

  /**
   * Helper to create success response
   */
  function successResponse(text: string): ToolResponse {
    return {
      content: [{ type: 'text', text }],
    };
  }

  /**
   * Delegate a task and handle the result
   */
  async function delegateFileTask(
    action: string,
    data: Record<string, unknown>,
    description: string
  ): Promise<TaskResult> {
    const taskId = `mcp-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

    return bridge.delegateTask({
      id: taskId,
      description,
      scope: 'execute',
      data: { action, ...data },
    });
  }

  // bridge_read_file
  handlers['bridge_read_file'] = async (args) => {
    const input = ReadFileInputSchema.parse(args);
    logger.debug({ path: input.path }, 'Reading file');

    try {
      const result = await delegateFileTask(
        'read_file',
        { path: input.path },
        `Read file: ${input.path}`
      );

      if (!result.success) {
        return errorResponse(result.error || 'Failed to read file');
      }

      return successResponse(result.data.content);
    } catch (err) {
      logger.error({ error: (err as Error).message, path: input.path }, 'Failed to read file');
      return errorResponse((err as Error).message);
    }
  };

  // bridge_write_file
  handlers['bridge_write_file'] = async (args) => {
    const input = WriteFileInputSchema.parse(args);
    logger.debug({ path: input.path, contentLength: input.content.length }, 'Writing file');

    try {
      const result = await delegateFileTask(
        'write_file',
        { path: input.path, content: input.content },
        `Write file: ${input.path}`
      );

      if (!result.success) {
        return errorResponse(result.error || 'Failed to write file');
      }

      return successResponse(`File written successfully: ${input.path} (${result.data.bytesWritten} bytes)`);
    } catch (err) {
      logger.error({ error: (err as Error).message, path: input.path }, 'Failed to write file');
      return errorResponse((err as Error).message);
    }
  };

  // bridge_delete_file
  handlers['bridge_delete_file'] = async (args) => {
    const input = DeleteFileInputSchema.parse(args);
    logger.debug({ path: input.path }, 'Deleting file');

    try {
      const result = await delegateFileTask(
        'delete_file',
        { path: input.path },
        `Delete file: ${input.path}`
      );

      if (!result.success) {
        return errorResponse(result.error || 'Failed to delete file');
      }

      return successResponse(`File deleted successfully: ${input.path}`);
    } catch (err) {
      logger.error({ error: (err as Error).message, path: input.path }, 'Failed to delete file');
      return errorResponse((err as Error).message);
    }
  };

  // bridge_list_directory
  handlers['bridge_list_directory'] = async (args) => {
    const input = ListDirectoryInputSchema.parse(args);
    logger.debug({ path: input.path }, 'Listing directory');

    try {
      const result = await delegateFileTask(
        'list_directory',
        { path: input.path },
        `List directory: ${input.path}`
      );

      if (!result.success) {
        return errorResponse(result.error || 'Failed to list directory');
      }

      // Format directory listing
      const entries = result.data.entries as Array<{ name: string; type: string }>;
      if (!entries || entries.length === 0) {
        return successResponse(`Directory is empty: ${input.path}`);
      }

      const listing = entries
        .map((e: { name: string; type: string }) => `${e.type === 'directory' ? '📁' : '📄'} ${e.name}`)
        .join('\n');

      return successResponse(`Contents of ${input.path}:\n${listing}`);
    } catch (err) {
      logger.error({ error: (err as Error).message, path: input.path }, 'Failed to list directory');
      return errorResponse((err as Error).message);
    }
  };

  // bridge_delegate_task
  handlers['bridge_delegate_task'] = async (args) => {
    const input = DelegateTaskInputSchema.parse(args);
    logger.debug({ description: input.description, scope: input.scope }, 'Delegating task');

    try {
      const taskId = `mcp-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

      const result = await bridge.delegateTask({
        id: taskId,
        description: input.description,
        scope: input.scope,
        data: input.data,
      });

      if (!result.success) {
        return errorResponse(result.error || 'Task failed');
      }

      return successResponse(JSON.stringify(result.data, null, 2));
    } catch (err) {
      logger.error({ error: (err as Error).message }, 'Failed to delegate task');
      return errorResponse((err as Error).message);
    }
  };

  // bridge_request_context
  handlers['bridge_request_context'] = async (args) => {
    const input = RequestContextInputSchema.parse(args);
    logger.debug({ query: input.query }, 'Requesting context');

    try {
      const files = await bridge.requestContext(input.query);

      if (files.length === 0) {
        return successResponse('No files found matching the query.');
      }

      // Format file results
      const fileResults = files.map(f => {
        const header = `=== ${f.path} ===`;
        const content = f.content;
        return `${header}\n${content}`;
      }).join('\n\n');

      return successResponse(`Found ${files.length} file(s):\n\n${fileResults}`);
    } catch (err) {
      logger.error({ error: (err as Error).message }, 'Failed to request context');
      return errorResponse((err as Error).message);
    }
  };

  // bridge_status
  handlers['bridge_status'] = async () => {
    logger.debug('Getting bridge status');

    const peers = bridge.getPeers();
    const peerCount = bridge.getPeerCount();
    const isStarted = bridge.isStarted();
    const mode = bridge.getMode();
    const instanceName = bridge.getInstanceName();

    const status = {
      instanceName,
      mode,
      started: isStarted,
      peerCount,
      peers: peers.map(p => ({
        id: p.id,
        name: p.name,
        connectedAt: new Date(p.connectedAt).toISOString(),
        lastActivity: new Date(p.lastActivity).toISOString(),
      })),
    };

    return successResponse(JSON.stringify(status, null, 2));
  };

  return handlers;
}

/**
 * Get JSON schema representation for a Zod schema
 * This creates a simple JSON schema object for MCP tool registration
 */
export function zodToJsonSchema(schema: z.ZodType<unknown>): Record<string, unknown> {
  // Handle ZodObject
  if (schema instanceof z.ZodObject) {
    const shape = schema.shape;
    const properties: Record<string, unknown> = {};
    const required: string[] = [];

    for (const [key, value] of Object.entries(shape)) {
      const zodValue = value as z.ZodType<unknown>;
      properties[key] = zodToJsonSchema(zodValue);

      // Check if required (not optional)
      if (!(zodValue instanceof z.ZodOptional)) {
        required.push(key);
      }
    }

    return {
      type: 'object',
      properties,
      ...(required.length > 0 ? { required } : {}),
    };
  }

  // Handle ZodString
  if (schema instanceof z.ZodString) {
    const result: Record<string, unknown> = { type: 'string' };
    if (schema.description) {
      result.description = schema.description;
    }
    return result;
  }

  // Handle ZodEnum
  if (schema instanceof z.ZodEnum) {
    return {
      type: 'string',
      enum: schema.options,
    };
  }

  // Handle ZodOptional
  if (schema instanceof z.ZodOptional) {
    return zodToJsonSchema(schema.unwrap());
  }

  // Handle ZodRecord
  if (schema instanceof z.ZodRecord) {
    return {
      type: 'object',
      additionalProperties: true,
    };
  }

  // Handle ZodUnknown
  if (schema instanceof z.ZodUnknown) {
    return {};
  }

  // Default fallback
  return { type: 'string' };
}
