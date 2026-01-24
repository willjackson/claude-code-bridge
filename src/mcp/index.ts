/**
 * MCP (Model Context Protocol) Server for Claude Code Bridge
 * Exposes bridge functionality as MCP tools for Claude Code integration
 */

export {
  BridgeMcpServer,
  startMcpServer,
  type McpServerConfig,
} from './server.js';

export {
  TOOL_DEFINITIONS,
  createToolHandlers,
  zodToJsonSchema,
  // Input schemas
  ReadFileInputSchema,
  WriteFileInputSchema,
  DeleteFileInputSchema,
  ListDirectoryInputSchema,
  DelegateTaskInputSchema,
  RequestContextInputSchema,
  // Types
  type ToolDefinition,
  type ToolResponse,
  type TextContent,
} from './tools.js';
