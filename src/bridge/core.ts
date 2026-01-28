/**
 * Bridge Core - Main orchestration class for Claude Code Bridge
 * Handles peer connections, message routing, and lifecycle management
 */

import { WebSocketServer, WebSocket as WsWebSocket } from 'ws';
import type { IncomingMessage } from 'http';
import * as https from 'https';
import { v4 as uuidv4 } from 'uuid';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { createLogger } from '../utils/logger.js';
import { WebSocketTransport } from '../transport/websocket.js';
import { ConnectionState, type Transport, type TLSConfig, type AuthConfig } from '../transport/interface.js';
import { loadCertificatesSync, isTLSEnabled } from '../utils/tls.js';
import { Authenticator, extractCredentials } from '../utils/auth.js';
import {
  type BridgeMessage,
  type TaskRequest,
  type TaskResult,
  type Context,
  type FileChunk,
  safeDeserializeMessage,
  serializeMessage,
} from './protocol.js';
import {
  createTaskDelegateMessage,
  createTaskResponseMessage,
  createContextSyncMessage,
  createContextRequestMessage,
} from './messages.js';

const logger = createLogger('bridge');

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Bridge operation mode
 * - 'host': Listen for incoming connections, sends commands via MCP
 * - 'client': Connect to host, receives and executes commands
 * - 'peer': Bidirectional mode - can both listen and connect
 */
export type BridgeMode = 'host' | 'client' | 'peer';

/**
 * Configuration for the bridge's listening server
 */
export interface BridgeListenConfig {
  /** Port to listen on */
  port: number;
  /** Host to bind to (default: 0.0.0.0) */
  host?: string;
  /** TLS configuration for secure connections */
  tls?: TLSConfig;
  /** Authentication configuration */
  auth?: AuthConfig;
}

/**
 * Configuration for connecting to a remote bridge
 */
export interface BridgeConnectConfig {
  /** Full WebSocket URL (e.g., ws://localhost:8765 or wss://localhost:8765) */
  url?: string;
  /** Use host.docker.internal for container-to-host connection */
  hostGateway?: boolean;
  /** Port to connect to (used if url is not provided) */
  port?: number;
  /** TLS configuration for secure connections */
  tls?: TLSConfig;
  /** Authentication configuration */
  auth?: AuthConfig;
}

/**
 * Context sharing configuration
 */
export interface ContextSharingConfig {
  /** Enable automatic context synchronization */
  autoSync?: boolean;
  /** Interval in milliseconds for auto-sync (default: 5000) */
  syncInterval?: number;
}

/**
 * Full configuration for Bridge initialization
 */
export interface BridgeConfig {
  /** Operation mode: 'host' or 'client' */
  mode: BridgeMode;
  /** Unique identifier for this bridge instance */
  instanceName: string;
  /** Server configuration (required for 'host' mode) */
  listen?: BridgeListenConfig;
  /** Connection configuration (required for 'client' mode) */
  connect?: BridgeConnectConfig;
  /** Task timeout in milliseconds (default: 300000 / 5 minutes) */
  taskTimeout?: number;
  /** Context sharing configuration */
  contextSharing?: ContextSharingConfig;
}

/**
 * Information about a connected peer
 */
export interface PeerInfo {
  /** Unique identifier for the peer connection */
  id: string;
  /** Name of the peer instance */
  name: string;
  /** Environment type of the peer */
  environment?: string;
  /** Timestamp when the peer connected */
  connectedAt: number;
  /** Timestamp of last activity from the peer */
  lastActivity: number;
}

/**
 * Internal peer connection tracking
 */
interface PeerConnection {
  /** Peer information */
  info: PeerInfo;
  /** WebSocket connection (for server-side connections) */
  ws?: WsWebSocket;
  /** Transport instance (for client-side connections) */
  transport?: Transport;
}

/**
 * Handler for peer connection events
 */
export type PeerConnectedHandler = (peer: PeerInfo) => void;

/**
 * Handler for peer disconnection events
 */
export type PeerDisconnectedHandler = (peer: PeerInfo) => void;

/**
 * Handler for incoming messages from peers
 */
export type MessageReceivedHandler = (message: BridgeMessage, peerId: string) => void;

/**
 * Handler for incoming task delegation requests
 * Returns a TaskResult or Promise<TaskResult>
 */
export type TaskReceivedHandler = (task: TaskRequest, peerId: string) => TaskResult | Promise<TaskResult>;

/**
 * Handler for incoming context synchronization
 */
export type ContextReceivedHandler = (context: Context, peerId: string) => void;

/**
 * Handler for incoming context requests
 * Returns FileChunk[] or Promise<FileChunk[]>
 */
export type ContextRequestedHandler = (query: string, peerId: string) => FileChunk[] | Promise<FileChunk[]>;

/**
 * Pending task tracking for response correlation
 */
interface PendingTask {
  taskId: string;
  peerId: string;
  resolve: (result: TaskResult) => void;
  reject: (error: Error) => void;
  timeoutId: ReturnType<typeof setTimeout>;
}

/**
 * Pending context request tracking for response correlation
 */
interface PendingContextRequest {
  requestId: string;
  peerId: string;
  resolve: (chunks: FileChunk[]) => void;
  reject: (error: Error) => void;
  timeoutId: ReturnType<typeof setTimeout>;
}

// ============================================================================
// Bridge Class
// ============================================================================

/**
 * Main Bridge class for host-client communication
 * Supports two modes of operation:
 * - 'host': Acts as a server, accepting client connections, sends commands via MCP
 * - 'client': Connects to a host, receives and executes commands with handlers
 */
export class Bridge {
  private config: BridgeConfig;
  private server: WebSocketServer | null = null;
  private httpsServer: https.Server | null = null;
  private clientTransport: WebSocketTransport | null = null;
  private peers: Map<string, PeerConnection> = new Map();
  private started: boolean = false;
  private authenticator: Authenticator | null = null;

  // Event handlers
  private peerConnectedHandlers: PeerConnectedHandler[] = [];
  private peerDisconnectedHandlers: PeerDisconnectedHandler[] = [];
  private messageReceivedHandlers: MessageReceivedHandler[] = [];
  private taskReceivedHandler: TaskReceivedHandler | null = null;
  private contextReceivedHandlers: ContextReceivedHandler[] = [];
  private contextRequestedHandler: ContextRequestedHandler | null = null;

  // Task correlation
  private pendingTasks: Map<string, PendingTask> = new Map();

  // Context request correlation
  private pendingContextRequests: Map<string, PendingContextRequest> = new Map();

  // Auto-sync interval timer
  private autoSyncIntervalId: ReturnType<typeof setInterval> | null = null;

  /**
   * Create a new Bridge instance
   * @param config Bridge configuration
   */
  constructor(config: BridgeConfig) {
    this.config = config;
    this.validateConfig();
    logger.info({ instanceName: config.instanceName, mode: config.mode }, 'Bridge instance created');
  }

  /**
   * Validate the configuration based on mode requirements
   */
  private validateConfig(): void {
    const { mode, listen, connect } = this.config;

    if (mode === 'host' && !listen) {
      throw new Error("'host' mode requires 'listen' configuration");
    }

    if (mode === 'client' && !connect) {
      throw new Error("'client' mode requires 'connect' configuration");
    }

    if (mode === 'peer' && !listen && !connect) {
      throw new Error("'peer' mode requires either 'listen' or 'connect' configuration");
    }
  }

  /**
   * Start the bridge based on configured mode
   * - 'host': Starts WebSocket server, sends commands via MCP
   * - 'client': Connects to host, receives and executes commands
   * - 'peer': Starts server (if listen configured) and connects to remote (if connect configured)
   */
  async start(): Promise<void> {
    if (this.started) {
      throw new Error('Bridge is already started');
    }

    const { mode } = this.config;
    logger.info({ mode }, 'Starting bridge');

    try {
      // Start server if in host mode or peer mode with listen config
      if ((mode === 'host' || mode === 'peer') && this.config.listen) {
        await this.startServer();
      }

      // Connect to remote if in client mode or peer mode with connect config
      if ((mode === 'client' || mode === 'peer') && this.config.connect) {
        await this.connectToRemote();
      }

      this.started = true;
      this.writeStatusFile();
      logger.info({ mode, instanceName: this.config.instanceName }, 'Bridge started successfully');
    } catch (error) {
      // Cleanup on failure
      await this.cleanup();
      throw error;
    }
  }

  /**
   * Stop the bridge and close all connections
   */
  async stop(): Promise<void> {
    if (!this.started) {
      return;
    }

    logger.info('Stopping bridge');
    await this.cleanup();
    this.started = false;
    logger.info('Bridge stopped');
  }

  /**
   * Get list of connected peers
   */
  getPeers(): PeerInfo[] {
    return Array.from(this.peers.values()).map(p => p.info);
  }

  /**
   * Connect to a remote bridge
   * @param url WebSocket URL to connect to
   */
  async connectToPeer(url: string): Promise<void> {
    const transport = new WebSocketTransport();

    // Set up message handler
    transport.onMessage((message) => {
      this.handleMessage(message, transport);
    });

    // Set up disconnect handler
    transport.onDisconnect(() => {
      this.handleClientDisconnect(transport);
    });

    try {
      await transport.connect({
        url,
        reconnect: true,
        reconnectInterval: 1000,
        maxReconnectAttempts: 10,
      });

      // Create peer info for the connected remote
      const peerId = uuidv4();
      const peerInfo: PeerInfo = {
        id: peerId,
        name: 'remote', // Will be updated when we receive peer info
        connectedAt: Date.now(),
        lastActivity: Date.now(),
      };

      this.peers.set(peerId, {
        info: peerInfo,
        transport,
      });

      // Store peerId on transport for lookup
      (transport as WebSocketTransport & { _peerId?: string })._peerId = peerId;

      this.notifyPeerConnected(peerInfo);
      logger.info({ peerId, url }, 'Connected to remote peer');
    } catch (error) {
      logger.error({ error: (error as Error).message, url }, 'Failed to connect to remote peer');
      throw error;
    }
  }

  /**
   * Disconnect from a specific peer
   * @param peerId ID of the peer to disconnect from
   */
  async disconnectFromPeer(peerId: string): Promise<void> {
    const peer = this.peers.get(peerId);
    if (!peer) {
      throw new Error(`Peer not found: ${peerId}`);
    }

    if (peer.transport) {
      await peer.transport.disconnect();
    }

    if (peer.ws) {
      peer.ws.close(1000, 'Disconnect requested');
    }

    this.peers.delete(peerId);
    this.notifyPeerDisconnected(peer.info);
    logger.info({ peerId }, 'Disconnected from peer');
  }

  /**
   * Send a message to a specific peer
   * @param peerId ID of the peer to send to
   * @param message Message to send
   */
  async sendToPeer(peerId: string, message: BridgeMessage): Promise<void> {
    const peer = this.peers.get(peerId);
    if (!peer) {
      throw new Error(`Peer not found: ${peerId}`);
    }

    if (peer.transport) {
      await peer.transport.send(message);
    } else if (peer.ws) {
      const serialized = serializeMessage(message);
      await new Promise<void>((resolve, reject) => {
        peer.ws!.send(serialized, (error) => {
          if (error) {
            reject(error);
          } else {
            resolve();
          }
        });
      });
    } else {
      throw new Error('No transport available for peer');
    }

    logger.debug({ peerId, messageId: message.id, type: message.type }, 'Sent message to peer');
  }

  /**
   * Broadcast a message to all connected peers
   * @param message Message to broadcast
   */
  async broadcast(message: BridgeMessage): Promise<void> {
    const sendPromises = Array.from(this.peers.keys()).map(peerId =>
      this.sendToPeer(peerId, message).catch(error => {
        logger.error({ error: (error as Error).message, peerId }, 'Failed to send to peer');
      })
    );

    await Promise.all(sendPromises);
    logger.debug({ messageId: message.id, peerCount: this.peers.size }, 'Broadcast message sent');
  }

  // ============================================================================
  // Event Registration
  // ============================================================================

  /**
   * Register a handler for peer connection events
   */
  onPeerConnected(handler: PeerConnectedHandler): void {
    this.peerConnectedHandlers.push(handler);
  }

  /**
   * Register a handler for peer disconnection events
   */
  onPeerDisconnected(handler: PeerDisconnectedHandler): void {
    this.peerDisconnectedHandlers.push(handler);
  }

  /**
   * Register a handler for incoming messages
   */
  onMessage(handler: MessageReceivedHandler): void {
    this.messageReceivedHandlers.push(handler);
  }

  /**
   * Register a handler for incoming task delegation requests
   * Only one handler can be registered at a time
   * @param handler Function that receives a TaskRequest and returns a TaskResult
   */
  onTaskReceived(handler: TaskReceivedHandler): void {
    this.taskReceivedHandler = handler;
  }

  /**
   * Register a handler for incoming context synchronization
   * Multiple handlers can be registered
   * @param handler Function that receives context and peerId
   */
  onContextReceived(handler: ContextReceivedHandler): void {
    this.contextReceivedHandlers.push(handler);
  }

  /**
   * Register a handler for incoming context requests
   * Only one handler can be registered at a time
   * @param handler Function that receives a query and returns FileChunk[]
   */
  onContextRequested(handler: ContextRequestedHandler): void {
    this.contextRequestedHandler = handler;
  }

  // ============================================================================
  // Task Delegation
  // ============================================================================

  /**
   * Delegate a task to a peer and wait for the result
   * @param task The task request to delegate
   * @param peerId Optional peer ID to send to (defaults to first peer)
   * @returns Promise that resolves with the task result
   * @throws Error if no peers are connected or task times out
   */
  async delegateTask(task: TaskRequest, peerId?: string): Promise<TaskResult> {
    // Get target peer
    if (!peerId) {
      const peers = this.getPeers();
      if (peers.length === 0) {
        throw new Error('No peers connected to delegate task to');
      }
      peerId = peers[0].id;
    }

    // Validate peer exists
    if (!this.peers.has(peerId)) {
      throw new Error(`Peer not found: ${peerId}`);
    }

    // Determine timeout
    const timeout = task.timeout ?? this.config.taskTimeout ?? 300000; // Default 5 minutes

    // Create promise to track task completion
    return new Promise<TaskResult>((resolve, reject) => {
      // Create the task delegate message
      const message = createTaskDelegateMessage(this.config.instanceName, task);

      // Set up timeout
      const timeoutId = setTimeout(() => {
        const pending = this.pendingTasks.get(task.id);
        if (pending) {
          this.pendingTasks.delete(task.id);
          reject(new Error(`Task '${task.id}' timed out after ${timeout}ms`));
        }
      }, timeout);

      // Store pending task for correlation
      this.pendingTasks.set(task.id, {
        taskId: task.id,
        peerId,
        resolve,
        reject,
        timeoutId,
      });

      // Send the task
      this.sendToPeer(peerId, message).catch((error) => {
        // Clean up on send error
        clearTimeout(timeoutId);
        this.pendingTasks.delete(task.id);
        reject(error);
      });

      logger.debug({ taskId: task.id, peerId, timeout }, 'Task delegated');
    });
  }

  // ============================================================================
  // Context Synchronization
  // ============================================================================

  /**
   * Synchronize context with connected peers
   * @param context Optional context to sync. If not provided, broadcasts to all peers
   * @param peerId Optional peer ID to send to (defaults to all peers)
   */
  async syncContext(context?: Context, peerId?: string): Promise<void> {
    // Use empty context if not provided
    const contextToSync = context ?? {};

    // Create the context sync message
    const message = createContextSyncMessage(this.config.instanceName, contextToSync);

    if (peerId) {
      // Send to specific peer
      await this.sendToPeer(peerId, message);
      logger.debug({ peerId, messageId: message.id }, 'Context synced to peer');
    } else {
      // Broadcast to all peers
      await this.broadcast(message);
      logger.debug({ peerCount: this.peers.size, messageId: message.id }, 'Context synced to all peers');
    }
  }

  /**
   * Request context from a peer based on a query
   * @param query Description of what context is being requested
   * @param peerId Optional peer ID to request from (defaults to first peer)
   * @param timeout Optional timeout in milliseconds (default: 30000)
   * @returns Promise that resolves with FileChunk[] from the peer
   * @throws Error if no peers are connected or request times out
   */
  async requestContext(query: string, peerId?: string, timeout: number = 30000): Promise<FileChunk[]> {
    // Get target peer
    if (!peerId) {
      const peers = this.getPeers();
      if (peers.length === 0) {
        throw new Error('No peers connected to request context from');
      }
      peerId = peers[0].id;
    }

    // Validate peer exists
    if (!this.peers.has(peerId)) {
      throw new Error(`Peer not found: ${peerId}`);
    }

    // Create promise to track request completion
    return new Promise<FileChunk[]>((resolve, reject) => {
      // Create the context request message
      const message = createContextRequestMessage(this.config.instanceName, query);

      // Set up timeout
      const timeoutId = setTimeout(() => {
        const pending = this.pendingContextRequests.get(message.id);
        if (pending) {
          this.pendingContextRequests.delete(message.id);
          reject(new Error(`Context request timed out after ${timeout}ms`));
        }
      }, timeout);

      // Store pending request for correlation
      this.pendingContextRequests.set(message.id, {
        requestId: message.id,
        peerId,
        resolve,
        reject,
        timeoutId,
      });

      // Send the request
      this.sendToPeer(peerId, message).catch((error) => {
        // Clean up on send error
        clearTimeout(timeoutId);
        this.pendingContextRequests.delete(message.id);
        reject(error);
      });

      logger.debug({ requestId: message.id, peerId, query }, 'Context requested');
    });
  }

  /**
   * Start automatic context synchronization
   * Uses interval from config.contextSharing.syncInterval (default: 5000ms)
   * @param contextProvider Optional function that returns context to sync
   */
  startAutoSync(contextProvider?: () => Context | Promise<Context>): void {
    // Stop any existing auto-sync
    this.stopAutoSync();

    const interval = this.config.contextSharing?.syncInterval ?? 5000;

    this.autoSyncIntervalId = setInterval(async () => {
      try {
        // Get context from provider if available
        const context = contextProvider ? await contextProvider() : undefined;
        await this.syncContext(context);
      } catch (error) {
        logger.error({ error: (error as Error).message }, 'Auto-sync error');
      }
    }, interval);

    logger.info({ interval }, 'Auto-sync started');
  }

  /**
   * Stop automatic context synchronization
   */
  stopAutoSync(): void {
    if (this.autoSyncIntervalId) {
      clearInterval(this.autoSyncIntervalId);
      this.autoSyncIntervalId = null;
      logger.info('Auto-sync stopped');
    }
  }

  // ============================================================================
  // Private Methods - Server
  // ============================================================================

  /**
   * Start the WebSocket server
   * If TLS is configured, starts an HTTPS server with WebSocket upgrade
   * If auth is configured, validates connections before accepting
   */
  private async startServer(): Promise<void> {
    const { listen } = this.config;
    if (!listen) {
      throw new Error('Listen configuration is required');
    }

    const host = listen.host ?? '0.0.0.0';
    const port = listen.port;
    const useTls = isTLSEnabled(listen.tls);

    // Set up authenticator if auth is configured
    if (listen.auth && listen.auth.type !== 'none') {
      this.authenticator = new Authenticator(listen.auth);
      logger.info({ authType: listen.auth.type }, 'Authentication enabled');
    }

    return new Promise<void>((resolve, reject) => {
      logger.debug({ host, port, tls: useTls, auth: !!this.authenticator }, 'Starting WebSocket server');

      try {
        if (useTls && listen.tls) {
          // Load TLS certificates
          const tlsOptions = loadCertificatesSync(listen.tls);
          logger.info({ host, port }, 'Starting secure WebSocket server (wss://)');

          // Create HTTPS server
          this.httpsServer = https.createServer({
            cert: tlsOptions.cert,
            key: tlsOptions.key,
            ca: tlsOptions.ca,
            passphrase: tlsOptions.passphrase,
          });

          // Create WebSocket server attached to HTTPS server
          const wsOptions: import('ws').ServerOptions = {
            server: this.httpsServer,
          };

          // Add verifyClient for authentication
          if (this.authenticator) {
            wsOptions.verifyClient = (info, callback) => {
              this.verifyClient(info, callback);
            };
          }

          this.server = new WebSocketServer(wsOptions);

          // Start HTTPS server
          this.httpsServer.listen(port, host, () => {
            logger.info({ host, port, protocol: 'wss' }, 'Secure WebSocket server listening');
            resolve();
          });

          this.httpsServer.on('error', (error) => {
            logger.error({ error: (error as Error).message }, 'HTTPS server error');
            reject(error);
          });
        } else {
          // Create plain WebSocket server
          const wsOptions: import('ws').ServerOptions = {
            host,
            port,
          };

          // Add verifyClient for authentication
          if (this.authenticator) {
            wsOptions.verifyClient = (info, callback) => {
              this.verifyClient(info, callback);
            };
          }

          this.server = new WebSocketServer(wsOptions);

          this.server.on('listening', () => {
            logger.info({ host, port, protocol: 'ws' }, 'WebSocket server listening');
            resolve();
          });

          this.server.on('error', (error) => {
            logger.error({ error: (error as Error).message }, 'WebSocket server error');
            reject(error);
          });
        }

        this.server.on('connection', (ws, request) => {
          this.handleNewConnection(ws, request);
        });
      } catch (error) {
        logger.error({ error: (error as Error).message }, 'Failed to start server');
        reject(error);
      }
    });
  }

  /**
   * Verify client connection for authentication
   * Used as WebSocketServer verifyClient callback
   */
  private verifyClient(
    info: { origin: string; secure: boolean; req: IncomingMessage },
    callback: (res: boolean, code?: number, message?: string, headers?: Record<string, string>) => void
  ): void {
    if (!this.authenticator) {
      callback(true);
      return;
    }

    const result = this.authenticator.authenticate(info.req);

    if (result.success) {
      logger.info({ clientIp: result.clientIp, method: result.method }, 'Client authenticated');
      callback(true);
    } else {
      logger.warn({ clientIp: result.clientIp, error: result.error }, 'Client authentication failed');
      // Use custom close code 4001 for authentication failure
      callback(false, 4001, result.error || 'Authentication failed');
    }
  }

  /**
   * Handle a new incoming connection
   */
  private handleNewConnection(ws: WsWebSocket, request: { url?: string }): void {
    const peerId = uuidv4();
    const peerInfo: PeerInfo = {
      id: peerId,
      name: 'client', // Will be updated when we receive peer info
      connectedAt: Date.now(),
      lastActivity: Date.now(),
    };

    this.peers.set(peerId, {
      info: peerInfo,
      ws,
    });

    logger.info({ peerId, url: request.url }, 'New peer connected');

    // Set up message handler
    ws.on('message', (data) => {
      const messageString = data.toString();
      const result = safeDeserializeMessage(messageString);

      if (result.success) {
        peerInfo.lastActivity = Date.now();
        this.handleMessage(result.data, ws, peerId);
      } else {
        logger.warn({ peerId, error: result.error.message }, 'Invalid message received');
      }
    });

    // Set up close handler
    ws.on('close', (code, reason) => {
      logger.info({ peerId, code, reason: reason.toString() }, 'Peer disconnected');
      this.peers.delete(peerId);
      this.notifyPeerDisconnected(peerInfo);
    });

    // Set up error handler
    ws.on('error', (error) => {
      logger.error({ peerId, error: (error as Error).message }, 'Peer connection error');
    });

    // Notify peer connected handlers
    this.notifyPeerConnected(peerInfo);
  }

  // ============================================================================
  // Private Methods - Client
  // ============================================================================

  /**
   * Connect to a remote bridge as a client
   */
  private async connectToRemote(): Promise<void> {
    const { connect } = this.config;
    if (!connect) {
      throw new Error('Connect configuration is required');
    }

    // Build URL from config
    let url = connect.url;
    if (!url) {
      const host = connect.hostGateway ? 'host.docker.internal' : 'localhost';
      const port = connect.port ?? 8765;
      // Use wss:// if TLS is configured
      const protocol = isTLSEnabled(connect.tls) || connect.tls?.ca ? 'wss' : 'ws';
      url = `${protocol}://${host}:${port}`;
    }

    this.clientTransport = new WebSocketTransport();

    // Set up message handler
    this.clientTransport.onMessage((message) => {
      this.handleMessage(message, this.clientTransport!);
    });

    // Set up disconnect handler
    this.clientTransport.onDisconnect(() => {
      this.handleClientDisconnect(this.clientTransport!);
    });

    try {
      await this.clientTransport.connect({
        url,
        reconnect: true,
        reconnectInterval: 1000,
        maxReconnectAttempts: 10,
        tls: connect.tls,
        auth: connect.auth,
      });

      // Create peer info for the connected server
      const peerId = uuidv4();
      const peerInfo: PeerInfo = {
        id: peerId,
        name: 'server',
        connectedAt: Date.now(),
        lastActivity: Date.now(),
      };

      this.peers.set(peerId, {
        info: peerInfo,
        transport: this.clientTransport,
      });

      // Store peerId on transport for lookup
      (this.clientTransport as WebSocketTransport & { _peerId?: string })._peerId = peerId;

      this.notifyPeerConnected(peerInfo);
      logger.info({ peerId, url }, 'Connected to remote bridge');
    } catch (error) {
      logger.error({ error: (error as Error).message }, 'Failed to connect to remote bridge');
      this.clientTransport = null;
      throw error;
    }
  }

  /**
   * Handle client transport disconnect
   */
  private handleClientDisconnect(transport: Transport): void {
    // Find peer by transport
    const typedTransport = transport as WebSocketTransport & { _peerId?: string };
    const peerId = typedTransport._peerId;

    if (peerId) {
      const peer = this.peers.get(peerId);
      if (peer) {
        this.peers.delete(peerId);
        this.notifyPeerDisconnected(peer.info);
        logger.info({ peerId }, 'Client transport disconnected');
      }
    }
  }

  // ============================================================================
  // Private Methods - Message Handling
  // ============================================================================

  /**
   * Handle an incoming message
   */
  private handleMessage(
    message: BridgeMessage,
    source: WsWebSocket | Transport,
    peerId?: string
  ): void {
    // Find peerId if not provided
    if (!peerId) {
      const typedSource = source as WebSocketTransport & { _peerId?: string };
      peerId = typedSource._peerId;
    }

    if (!peerId) {
      // Try to find by ws reference
      for (const [id, peer] of this.peers) {
        if (peer.ws === source || peer.transport === source) {
          peerId = id;
          break;
        }
      }
    }

    if (!peerId) {
      logger.warn({ messageId: message.id }, 'Received message from unknown peer');
      return;
    }

    // Update last activity
    const peer = this.peers.get(peerId);
    if (peer) {
      peer.info.lastActivity = Date.now();
    }

    logger.debug({ peerId, messageId: message.id, type: message.type }, 'Received message');

    // Handle task delegation messages
    if (message.type === 'task_delegate' && message.task) {
      this.handleTaskDelegate(message, peerId);
      return;
    }

    // Handle task response messages
    if (message.type === 'response' && message.result?.taskId) {
      this.handleTaskResponse(message);
      return;
    }

    // Handle context sync messages
    if (message.type === 'context_sync' && message.context) {
      this.handleContextSync(message, peerId);
      return;
    }

    // Handle context request messages
    if (message.type === 'request' && message.context?.summary) {
      this.handleContextRequest(message, peerId);
      return;
    }

    // Handle context response messages (responses to context requests)
    if (message.type === 'response' && message.context?.files !== undefined) {
      this.handleContextResponse(message);
      return;
    }

    // Notify message handlers for other message types
    this.notifyMessageReceived(message, peerId);
  }

  /**
   * Handle incoming task delegation request
   */
  private async handleTaskDelegate(message: BridgeMessage, peerId: string): Promise<void> {
    const task = message.task!;
    logger.debug({ taskId: task.id, peerId }, 'Received task delegation');

    // If no handler registered, try to forward to another peer
    if (!this.taskReceivedHandler) {
      // Find another peer to forward to (not the sender)
      const otherPeers = Array.from(this.peers.keys()).filter(id => id !== peerId);

      if (otherPeers.length > 0) {
        // Forward to the first available peer
        const targetPeerId = otherPeers[0];
        logger.info({ taskId: task.id, targetPeerId }, 'Forwarding task to another peer');

        try {
          // Forward the original message
          await this.sendToPeer(targetPeerId, message);

          // Set up response forwarding - store the original sender
          const forwardKey = `forward:${task.id}`;
          (this as unknown as Record<string, string>)[forwardKey] = peerId;

          return;
        } catch (err) {
          logger.error({ error: (err as Error).message, taskId: task.id }, 'Failed to forward task');
        }
      }

      logger.warn({ taskId: task.id }, 'No task handler registered and no peers to forward to');
      const response = createTaskResponseMessage(
        this.config.instanceName,
        task.id,
        {
          success: false,
          data: null,
          error: 'No task handler registered on peer',
        }
      );
      await this.sendToPeer(peerId, response).catch((err) => {
        logger.error({ error: (err as Error).message, taskId: task.id }, 'Failed to send error response');
      });
      return;
    }

    try {
      // Execute the task handler
      const result = await this.taskReceivedHandler(task, peerId);

      // Send successful response
      const response = createTaskResponseMessage(
        this.config.instanceName,
        task.id,
        result
      );
      await this.sendToPeer(peerId, response);
      logger.debug({ taskId: task.id, success: result.success }, 'Task response sent');
    } catch (error) {
      // Send error response
      const response = createTaskResponseMessage(
        this.config.instanceName,
        task.id,
        {
          success: false,
          data: null,
          error: (error as Error).message,
        }
      );
      await this.sendToPeer(peerId, response).catch((err) => {
        logger.error({ error: (err as Error).message, taskId: task.id }, 'Failed to send error response');
      });
      logger.error({ taskId: task.id, error: (error as Error).message }, 'Task handler error');
    }
  }

  /**
   * Handle task response message (correlate with pending task)
   */
  private async handleTaskResponse(message: BridgeMessage): Promise<void> {
    const taskId = message.result!.taskId!;

    // Check if this is a forwarded response that needs to go back to original sender
    const forwardKey = `forward:${taskId}`;
    const originalSender = (this as unknown as Record<string, string>)[forwardKey];
    if (originalSender) {
      delete (this as unknown as Record<string, string>)[forwardKey];
      logger.info({ taskId, originalSender }, 'Forwarding task response to original sender');
      await this.sendToPeer(originalSender, message).catch((err) => {
        logger.error({ error: (err as Error).message, taskId }, 'Failed to forward response');
      });
      return;
    }

    const pending = this.pendingTasks.get(taskId);

    if (!pending) {
      logger.warn({ taskId }, 'Received response for unknown task');
      return;
    }

    // Clear timeout and remove from pending
    clearTimeout(pending.timeoutId);
    this.pendingTasks.delete(taskId);

    // Resolve the promise with the result
    const result: TaskResult = {
      taskId: message.result!.taskId,
      success: message.result!.success,
      data: message.result!.data,
      artifacts: message.result!.artifacts,
      followUp: message.result!.followUp,
      error: message.result!.error,
    };

    logger.debug({ taskId, success: result.success }, 'Task result received');
    pending.resolve(result);
  }

  /**
   * Handle incoming context sync message
   */
  private handleContextSync(message: BridgeMessage, peerId: string): void {
    const context = message.context!;
    logger.debug({ peerId, messageId: message.id }, 'Received context sync');

    // Notify all context received handlers
    this.notifyContextReceived(context, peerId);
  }

  /**
   * Handle incoming context request message
   */
  private async handleContextRequest(message: BridgeMessage, peerId: string): Promise<void> {
    const query = message.context!.summary!;
    logger.debug({ peerId, messageId: message.id, query }, 'Received context request');

    // If no handler registered, try to forward to another peer
    if (!this.contextRequestedHandler) {
      // Find another peer to forward to (not the sender)
      const otherPeers = Array.from(this.peers.keys()).filter(id => id !== peerId);

      if (otherPeers.length > 0) {
        // Forward to the first available peer
        const targetPeerId = otherPeers[0];
        logger.info({ messageId: message.id, targetPeerId }, 'Forwarding context request to another peer');

        try {
          // Forward the original message
          await this.sendToPeer(targetPeerId, message);

          // Set up response forwarding - store the original sender
          const forwardKey = `ctxfwd:${message.id}`;
          (this as unknown as Record<string, string>)[forwardKey] = peerId;

          return;
        } catch (err) {
          logger.error({ error: (err as Error).message, messageId: message.id }, 'Failed to forward context request');
        }
      }

      logger.warn({ messageId: message.id }, 'No context request handler registered and no peers to forward to');
      const response = createContextSyncMessage(this.config.instanceName, { files: [] });
      // Change type to response and add request ID for correlation
      const responseMessage: BridgeMessage = {
        ...response,
        type: 'response',
        context: {
          ...response.context,
          variables: { requestId: message.id },
        },
      };
      await this.sendToPeer(peerId, responseMessage).catch((err) => {
        logger.error({ error: (err as Error).message, messageId: message.id }, 'Failed to send empty context response');
      });
      return;
    }

    try {
      // Execute the context request handler
      const files = await this.contextRequestedHandler(query, peerId);

      // Create and send response
      const response = createContextSyncMessage(this.config.instanceName, { files });
      const responseMessage: BridgeMessage = {
        ...response,
        type: 'response',
        context: {
          ...response.context,
          variables: { requestId: message.id },
        },
      };
      await this.sendToPeer(peerId, responseMessage);
      logger.debug({ messageId: message.id, fileCount: files.length }, 'Context response sent');
    } catch (error) {
      // Send error response with empty files
      const response = createContextSyncMessage(this.config.instanceName, {
        files: [],
        summary: (error as Error).message,
      });
      const responseMessage: BridgeMessage = {
        ...response,
        type: 'response',
        context: {
          ...response.context,
          variables: { requestId: message.id, error: (error as Error).message },
        },
      };
      await this.sendToPeer(peerId, responseMessage).catch((err) => {
        logger.error({ error: (err as Error).message, messageId: message.id }, 'Failed to send error context response');
      });
      logger.error({ messageId: message.id, error: (error as Error).message }, 'Context request handler error');
    }
  }

  /**
   * Handle context response message (correlate with pending context request)
   */
  private async handleContextResponse(message: BridgeMessage): Promise<void> {
    const requestId = message.context?.variables?.requestId as string;
    if (!requestId) {
      logger.warn({ messageId: message.id }, 'Context response without requestId');
      return;
    }

    // Check if this is a forwarded response that needs to go back to original sender
    const forwardKey = `ctxfwd:${requestId}`;
    const originalSender = (this as unknown as Record<string, string>)[forwardKey];
    if (originalSender) {
      delete (this as unknown as Record<string, string>)[forwardKey];
      logger.info({ requestId, originalSender }, 'Forwarding context response to original sender');
      await this.sendToPeer(originalSender, message).catch((err) => {
        logger.error({ error: (err as Error).message, requestId }, 'Failed to forward context response');
      });
      return;
    }

    const pending = this.pendingContextRequests.get(requestId);
    if (!pending) {
      logger.warn({ requestId }, 'Received response for unknown context request');
      return;
    }

    // Clear timeout and remove from pending
    clearTimeout(pending.timeoutId);
    this.pendingContextRequests.delete(requestId);

    // Check for error
    const error = message.context?.variables?.error as string | undefined;
    if (error) {
      pending.reject(new Error(error));
      return;
    }

    // Resolve the promise with the files
    const files = message.context?.files ?? [];
    logger.debug({ requestId, fileCount: files.length }, 'Context response received');
    pending.resolve(files);
  }

  // ============================================================================
  // Private Methods - Event Notification
  // ============================================================================

  private notifyPeerConnected(peer: PeerInfo): void {
    // Update status file with new peer
    this.writeStatusFile();

    for (const handler of this.peerConnectedHandlers) {
      try {
        handler(peer);
      } catch (error) {
        logger.error({ error: (error as Error).message }, 'Peer connected handler error');
      }
    }
  }

  private notifyPeerDisconnected(peer: PeerInfo): void {
    // Reject any pending tasks for this peer
    for (const [taskId, pending] of this.pendingTasks) {
      if (pending.peerId === peer.id) {
        clearTimeout(pending.timeoutId);
        this.pendingTasks.delete(taskId);
        pending.reject(new Error(`Peer '${peer.id}' disconnected while task '${taskId}' was pending`));
      }
    }

    // Reject any pending context requests for this peer
    for (const [requestId, pending] of this.pendingContextRequests) {
      if (pending.peerId === peer.id) {
        clearTimeout(pending.timeoutId);
        this.pendingContextRequests.delete(requestId);
        pending.reject(new Error(`Peer '${peer.id}' disconnected while context request '${requestId}' was pending`));
      }
    }

    for (const handler of this.peerDisconnectedHandlers) {
      try {
        handler(peer);
      } catch (error) {
        logger.error({ error: (error as Error).message }, 'Peer disconnected handler error');
      }
    }

    // Update status file after peer removed
    this.writeStatusFile();
  }

  private notifyMessageReceived(message: BridgeMessage, peerId: string): void {
    for (const handler of this.messageReceivedHandlers) {
      try {
        handler(message, peerId);
      } catch (error) {
        logger.error({ error: (error as Error).message }, 'Message received handler error');
      }
    }
  }

  private notifyContextReceived(context: Context, peerId: string): void {
    for (const handler of this.contextReceivedHandlers) {
      try {
        handler(context, peerId);
      } catch (error) {
        logger.error({ error: (error as Error).message }, 'Context received handler error');
      }
    }
  }

  // ============================================================================
  // Private Methods - Cleanup
  // ============================================================================

  /**
   * Clean up all resources
   */
  private async cleanup(): Promise<void> {
    logger.debug('Starting cleanup');

    // Stop auto-sync
    this.stopAutoSync();
    logger.debug('Auto-sync stopped');

    // Reject all pending tasks
    const pendingTaskCount = this.pendingTasks.size;
    for (const [taskId, pending] of this.pendingTasks) {
      clearTimeout(pending.timeoutId);
      pending.reject(new Error('Bridge is shutting down'));
    }
    this.pendingTasks.clear();
    if (pendingTaskCount > 0) {
      logger.debug({ count: pendingTaskCount }, 'Pending tasks cancelled');
    }

    // Reject all pending context requests
    const pendingContextCount = this.pendingContextRequests.size;
    for (const [requestId, pending] of this.pendingContextRequests) {
      clearTimeout(pending.timeoutId);
      pending.reject(new Error('Bridge is shutting down'));
    }
    this.pendingContextRequests.clear();
    if (pendingContextCount > 0) {
      logger.debug({ count: pendingContextCount }, 'Pending context requests cancelled');
    }

    // Disconnect client transport
    if (this.clientTransport) {
      logger.debug('Disconnecting client transport');
      try {
        await this.clientTransport.disconnect();
        logger.debug('Client transport disconnected');
      } catch {
        // Ignore disconnect errors during cleanup
      }
      this.clientTransport = null;
    }

    // Close all peer WebSocket connections
    const peerCount = this.peers.size;
    if (peerCount > 0) {
      logger.debug({ count: peerCount }, 'Closing peer connections');
    }
    for (const [peerId, peer] of this.peers) {
      if (peer.ws) {
        try {
          peer.ws.close(1000, 'Bridge stopping');
        } catch {
          // Ignore close errors during cleanup
        }
      }
      if (peer.transport) {
        try {
          await peer.transport.disconnect();
        } catch {
          // Ignore disconnect errors during cleanup
        }
      }
      logger.debug({ peerId }, 'Peer disconnected');
    }
    this.peers.clear();

    // Close server
    if (this.server) {
      logger.debug('Closing WebSocket server');
      await new Promise<void>((resolve) => {
        this.server!.close(() => {
          resolve();
        });
      });
      this.server = null;
      logger.debug('WebSocket server closed');
    }

    // Close HTTPS server if it exists
    if (this.httpsServer) {
      logger.debug('Closing HTTPS server');
      await new Promise<void>((resolve) => {
        this.httpsServer!.close(() => {
          resolve();
        });
      });
      this.httpsServer = null;
      logger.debug('HTTPS server closed');
    }

    // Remove status file
    this.removeStatusFile();

    logger.debug('Cleanup complete');
  }

  // ============================================================================
  // Status File Management
  // ============================================================================

  /**
   * Get the status file path
   */
  private getStatusFilePath(): string {
    const bridgeDir = path.join(os.homedir(), '.claude-bridge');
    return path.join(bridgeDir, 'status.json');
  }

  /**
   * Ensure the .claude-bridge directory exists
   */
  private ensureBridgeDir(): void {
    const bridgeDir = path.join(os.homedir(), '.claude-bridge');
    if (!fs.existsSync(bridgeDir)) {
      fs.mkdirSync(bridgeDir, { recursive: true });
    }
  }

  /**
   * Write current status to status file
   */
  private writeStatusFile(): void {
    try {
      this.ensureBridgeDir();
      const statusFile = this.getStatusFilePath();
      const status = {
        port: this.config.listen?.port,
        instanceName: this.config.instanceName,
        mode: this.config.mode,
        peers: this.getPeers().map(p => ({
          id: p.id,
          name: p.name,
          connectedAt: new Date(p.connectedAt).toISOString(),
          lastActivity: new Date(p.lastActivity).toISOString(),
        })),
      };
      fs.writeFileSync(statusFile, JSON.stringify(status, null, 2), 'utf-8');
      logger.debug({ statusFile }, 'Status file updated');
    } catch (error) {
      logger.error({ error: (error as Error).message }, 'Failed to write status file');
    }
  }

  /**
   * Remove the status file
   */
  private removeStatusFile(): void {
    try {
      const statusFile = this.getStatusFilePath();
      if (fs.existsSync(statusFile)) {
        fs.unlinkSync(statusFile);
        logger.debug({ statusFile }, 'Status file removed');
      }
    } catch (error) {
      logger.error({ error: (error as Error).message }, 'Failed to remove status file');
    }
  }

  // ============================================================================
  // Getters for State Inspection
  // ============================================================================

  /**
   * Check if the bridge is started
   */
  isStarted(): boolean {
    return this.started;
  }

  /**
   * Get the instance name
   */
  getInstanceName(): string {
    return this.config.instanceName;
  }

  /**
   * Get the operation mode
   */
  getMode(): BridgeMode {
    return this.config.mode;
  }

  /**
   * Get the number of connected peers
   */
  getPeerCount(): number {
    return this.peers.size;
  }
}
