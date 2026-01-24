/**
 * MCP Server for Claude Code Bridge
 * Exposes bridge functionality as MCP tools for Claude Code integration
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolResult,
} from '@modelcontextprotocol/sdk/types.js';
import { Bridge, type BridgeConfig } from '../bridge/core.js';
import { createLogger } from '../utils/logger.js';
import {
  TOOL_DEFINITIONS,
  createToolHandlers,
  zodToJsonSchema,
} from './tools.js';

const logger = createLogger('mcp:server');

// ============================================================================
// MCP Server Configuration
// ============================================================================

export interface McpServerConfig {
  /** Bridge WebSocket URL to connect to */
  bridgeUrl: string;
  /** MCP server name (default: claude-bridge) */
  name?: string;
  /** MCP server version */
  version?: string;
  /** Instance name for the bridge client */
  instanceName?: string;
  /** Task timeout in milliseconds */
  taskTimeout?: number;
}

// ============================================================================
// Bridge MCP Server
// ============================================================================

/**
 * MCP Server that exposes bridge functionality as tools
 */
export class BridgeMcpServer {
  private server: Server;
  private bridge: Bridge;
  private config: McpServerConfig;
  private toolHandlers: ReturnType<typeof createToolHandlers> | null = null;

  constructor(config: McpServerConfig) {
    this.config = config;

    // Create MCP server
    this.server = new Server(
      {
        name: config.name ?? 'claude-bridge',
        version: config.version ?? '0.4.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    // Create bridge client to connect to daemon
    const bridgeConfig: BridgeConfig = {
      mode: 'client',
      instanceName: config.instanceName ?? `mcp-server-${process.pid}`,
      connect: {
        url: config.bridgeUrl,
      },
      taskTimeout: config.taskTimeout ?? 60000,
    };

    this.bridge = new Bridge(bridgeConfig);

    this.registerHandlers();
  }

  /**
   * Register MCP request handlers
   */
  private registerHandlers(): void {
    // List tools handler
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      logger.debug('Listing tools');

      return {
        tools: TOOL_DEFINITIONS.map(tool => ({
          name: tool.name,
          description: tool.description,
          inputSchema: zodToJsonSchema(tool.inputSchema),
        })),
      };
    });

    // Call tool handler
    this.server.setRequestHandler(CallToolRequestSchema, async (request): Promise<CallToolResult> => {
      const { name, arguments: args } = request.params;
      logger.debug({ tool: name }, 'Tool call received');

      // Ensure tool handlers are created
      if (!this.toolHandlers) {
        this.toolHandlers = createToolHandlers(this.bridge);
      }

      const handler = this.toolHandlers[name];
      if (!handler) {
        logger.warn({ tool: name }, 'Unknown tool requested');
        return {
          content: [{ type: 'text', text: `Unknown tool: ${name}` }],
          isError: true,
        };
      }

      try {
        const result = await handler(args ?? {});
        logger.debug({ tool: name, isError: result.isError }, 'Tool call completed');
        return {
          content: result.content,
          isError: result.isError,
        };
      } catch (err) {
        logger.error({ tool: name, error: (err as Error).message }, 'Tool call failed');
        return {
          content: [{ type: 'text', text: `Error: ${(err as Error).message}` }],
          isError: true,
        };
      }
    });
  }

  /**
   * Start the MCP server
   * Connects to bridge daemon and starts listening on stdio
   */
  async start(): Promise<void> {
    // Log to stderr since stdout is for MCP protocol
    console.error('[MCP] Starting bridge MCP server...');
    console.error(`[MCP] Connecting to bridge at ${this.config.bridgeUrl}`);

    try {
      // Connect to bridge daemon
      await this.bridge.start();
      console.error('[MCP] Connected to bridge daemon');

      // Create tool handlers after bridge is connected
      this.toolHandlers = createToolHandlers(this.bridge);

      // Start MCP server on stdio
      const transport = new StdioServerTransport();
      await this.server.connect(transport);

      console.error('[MCP] MCP server started and listening on stdio');
      logger.info('MCP server started');
    } catch (err) {
      console.error(`[MCP] Failed to start: ${(err as Error).message}`);
      throw err;
    }
  }

  /**
   * Stop the MCP server
   */
  async stop(): Promise<void> {
    console.error('[MCP] Stopping MCP server...');

    try {
      await this.bridge.stop();
      await this.server.close();
      console.error('[MCP] MCP server stopped');
      logger.info('MCP server stopped');
    } catch (err) {
      console.error(`[MCP] Error during shutdown: ${(err as Error).message}`);
    }
  }

  /**
   * Get the bridge instance
   */
  getBridge(): Bridge {
    return this.bridge;
  }
}

/**
 * Create and start an MCP server
 */
export async function startMcpServer(config: McpServerConfig): Promise<BridgeMcpServer> {
  const server = new BridgeMcpServer(config);
  await server.start();
  return server;
}
