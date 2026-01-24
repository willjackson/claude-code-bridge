/**
 * WebSocket Transport implementation for Claude Code Bridge
 * Provides WebSocket-based communication between bridge instances
 */

import WebSocket from 'ws';
import type { BridgeMessage } from '../bridge/protocol.js';
import { serializeMessage, safeDeserializeMessage } from '../bridge/protocol.js';
import {
  ConnectionState,
  type ConnectionConfig,
  type Transport,
  type MessageHandler,
  type DisconnectHandler,
  type ErrorHandler,
} from './interface.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('websocket-transport');

/** Default reconnection interval in milliseconds */
const DEFAULT_RECONNECT_INTERVAL = 1000;

/** Default maximum reconnection attempts */
const DEFAULT_MAX_RECONNECT_ATTEMPTS = 10;

/** Default heartbeat interval in milliseconds */
const DEFAULT_HEARTBEAT_INTERVAL = 30000;

/** Heartbeat timeout - how long to wait for pong response */
const HEARTBEAT_TIMEOUT = 10000;

/**
 * WebSocket-based transport implementation
 * Handles connection lifecycle, message sending/receiving, and event handling
 * Supports auto-reconnection, message queuing, and heartbeat monitoring
 */
export class WebSocketTransport implements Transport {
  private ws: WebSocket | null = null;
  private state: ConnectionState = ConnectionState.DISCONNECTED;
  private config: ConnectionConfig | null = null;

  // Reconnection state
  private reconnectAttempts: number = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private intentionalDisconnect: boolean = false;

  // Message queue for offline messages
  private messageQueue: BridgeMessage[] = [];

  // Heartbeat state
  private heartbeatInterval: ReturnType<typeof setInterval> | null = null;
  private heartbeatTimeout: ReturnType<typeof setTimeout> | null = null;
  private awaitingPong: boolean = false;

  // Event handlers
  private messageHandlers: MessageHandler[] = [];
  private disconnectHandlers: DisconnectHandler[] = [];
  private errorHandlers: ErrorHandler[] = [];
  private reconnectingHandlers: Array<(attempt: number, maxAttempts: number) => void> = [];

  /**
   * Build the WebSocket URL from the connection configuration
   */
  private buildUrl(config: ConnectionConfig): string {
    if (config.url) {
      return config.url;
    }

    const host = config.host ?? 'localhost';
    const port = config.port ?? 8765;
    return `ws://${host}:${port}`;
  }

  /**
   * Establish connection to a remote peer
   */
  async connect(config: ConnectionConfig): Promise<void> {
    if (this.state === ConnectionState.CONNECTED) {
      throw new Error('Already connected');
    }

    this.config = config;
    this.intentionalDisconnect = false;
    this.reconnectAttempts = 0;

    return this.establishConnection();
  }

  /**
   * Internal method to establish WebSocket connection
   * Used for both initial connection and reconnection attempts
   */
  private async establishConnection(): Promise<void> {
    if (!this.config) {
      throw new Error('No configuration set');
    }

    this.state = ConnectionState.CONNECTING;

    const url = this.buildUrl(this.config);
    logger.debug({ url, attempt: this.reconnectAttempts }, 'Connecting to WebSocket server');

    return new Promise<void>((resolve, reject) => {
      try {
        this.ws = new WebSocket(url);

        // Handle connection open
        this.ws.on('open', () => {
          this.state = ConnectionState.CONNECTED;
          this.reconnectAttempts = 0;
          logger.info({ url }, 'WebSocket connection established');

          // Start heartbeat monitoring
          this.startHeartbeat();

          // Flush queued messages
          this.flushMessageQueue();

          resolve();
        });

        // Handle incoming messages
        this.ws.on('message', (data: WebSocket.RawData) => {
          this.handleIncomingMessage(data);
        });

        // Handle pong responses for heartbeat
        this.ws.on('pong', () => {
          this.handlePong();
        });

        // Handle connection close
        this.ws.on('close', (code, reason) => {
          const wasConnected = this.state === ConnectionState.CONNECTED;
          const wasReconnecting = this.state === ConnectionState.RECONNECTING;

          // Stop heartbeat
          this.stopHeartbeat();

          logger.info({ code, reason: reason.toString() }, 'WebSocket connection closed');

          // Notify disconnect handlers only if we were previously connected
          if (wasConnected) {
            this.notifyDisconnect();
          }

          // Attempt reconnection if enabled and not intentional disconnect
          if (!this.intentionalDisconnect && this.shouldReconnect()) {
            this.scheduleReconnect();
          } else if (!wasReconnecting) {
            this.state = ConnectionState.DISCONNECTED;
          }
        });

        // Handle errors
        this.ws.on('error', (error: Error) => {
          logger.error({ error: error.message }, 'WebSocket error');

          // If we're still connecting (initial connection), reject the promise
          if (this.state === ConnectionState.CONNECTING && this.reconnectAttempts === 0) {
            this.state = ConnectionState.DISCONNECTED;
            reject(error);
            return;
          }

          // Notify error handlers
          this.notifyError(error);
        });
      } catch (error) {
        this.state = ConnectionState.DISCONNECTED;
        reject(error);
      }
    });
  }

  /**
   * Cleanly close the current connection
   */
  async disconnect(): Promise<void> {
    // Mark as intentional to prevent reconnection
    this.intentionalDisconnect = true;

    // Clear any pending reconnection timer
    this.clearReconnectTimer();

    // Stop heartbeat
    this.stopHeartbeat();

    // Clear message queue on intentional disconnect
    this.messageQueue = [];

    if (!this.ws || this.state === ConnectionState.DISCONNECTED) {
      this.state = ConnectionState.DISCONNECTED;
      return;
    }

    logger.debug('Disconnecting WebSocket');

    return new Promise<void>((resolve) => {
      if (!this.ws) {
        this.state = ConnectionState.DISCONNECTED;
        resolve();
        return;
      }

      // Set up close handler before closing
      const onClose = () => {
        this.state = ConnectionState.DISCONNECTED;
        this.ws = null;
        resolve();
      };

      // If already closed, resolve immediately
      if (this.ws.readyState === WebSocket.CLOSED) {
        onClose();
        return;
      }

      // Set up timeout in case close doesn't happen
      const timeout = setTimeout(() => {
        this.state = ConnectionState.DISCONNECTED;
        this.ws = null;
        resolve();
      }, 5000);

      this.ws.once('close', () => {
        clearTimeout(timeout);
        onClose();
      });

      // Initiate close
      this.ws.close(1000, 'Disconnect requested');
    });
  }

  /**
   * Send a message to the connected peer
   * If disconnected and reconnection is enabled, queues the message for later delivery
   */
  async send(message: BridgeMessage): Promise<void> {
    // If connected, send immediately
    if (this.ws && this.state === ConnectionState.CONNECTED) {
      return this.sendImmediate(message);
    }

    // If reconnecting and reconnection is enabled, queue the message
    if (this.shouldReconnect() && (this.state === ConnectionState.RECONNECTING || this.state === ConnectionState.DISCONNECTED)) {
      this.queueMessage(message);
      return;
    }

    throw new Error('Not connected');
  }

  /**
   * Immediately send a message over the WebSocket
   */
  private async sendImmediate(message: BridgeMessage): Promise<void> {
    if (!this.ws || this.state !== ConnectionState.CONNECTED) {
      throw new Error('Not connected');
    }

    const serialized = serializeMessage(message);
    logger.debug({ messageId: message.id, type: message.type }, 'Sending message');

    return new Promise<void>((resolve, reject) => {
      this.ws!.send(serialized, (error) => {
        if (error) {
          logger.error({ error: error.message, messageId: message.id }, 'Failed to send message');
          reject(error);
        } else {
          resolve();
        }
      });
    });
  }

  /**
   * Queue a message for later delivery when reconnected
   */
  private queueMessage(message: BridgeMessage): void {
    this.messageQueue.push(message);
    logger.debug({ messageId: message.id, queueLength: this.messageQueue.length }, 'Message queued for delivery');
  }

  /**
   * Flush all queued messages after reconnection
   */
  private async flushMessageQueue(): Promise<void> {
    if (this.messageQueue.length === 0) {
      return;
    }

    logger.info({ queueLength: this.messageQueue.length }, 'Flushing message queue');

    const messages = [...this.messageQueue];
    this.messageQueue = [];

    for (const message of messages) {
      try {
        await this.sendImmediate(message);
      } catch (error) {
        logger.error({ error: (error as Error).message, messageId: message.id }, 'Failed to send queued message');
        // Re-queue the failed message
        this.messageQueue.unshift(message);
        break;
      }
    }
  }

  /**
   * Register a handler for incoming messages
   */
  onMessage(handler: MessageHandler): void {
    this.messageHandlers.push(handler);
  }

  /**
   * Register a handler for disconnect events
   */
  onDisconnect(handler: DisconnectHandler): void {
    this.disconnectHandlers.push(handler);
  }

  /**
   * Register a handler for error events
   */
  onError(handler: ErrorHandler): void {
    this.errorHandlers.push(handler);
  }

  /**
   * Register a handler for reconnecting events
   */
  onReconnecting(handler: (attempt: number, maxAttempts: number) => void): void {
    this.reconnectingHandlers.push(handler);
  }

  /**
   * Check if the transport is currently connected
   */
  isConnected(): boolean {
    return this.state === ConnectionState.CONNECTED;
  }

  /**
   * Get the current connection state
   */
  getState(): ConnectionState {
    return this.state;
  }

  /**
   * Handle incoming WebSocket messages
   */
  private handleIncomingMessage(data: WebSocket.RawData): void {
    const messageString = data.toString();
    logger.debug({ dataLength: messageString.length }, 'Received message');

    const result = safeDeserializeMessage(messageString);

    if (!result.success) {
      logger.warn({ error: result.error.message }, 'Failed to parse incoming message');
      this.notifyError(new Error(`Invalid message format: ${result.error.message}`));
      return;
    }

    const message = result.data;
    logger.debug({ messageId: message.id, type: message.type }, 'Parsed message');

    // Notify all message handlers
    for (const handler of this.messageHandlers) {
      try {
        handler(message);
      } catch (error) {
        logger.error({ error: (error as Error).message }, 'Message handler threw error');
      }
    }
  }

  /**
   * Notify all disconnect handlers
   */
  private notifyDisconnect(): void {
    for (const handler of this.disconnectHandlers) {
      try {
        handler();
      } catch (error) {
        logger.error({ error: (error as Error).message }, 'Disconnect handler threw error');
      }
    }
  }

  /**
   * Notify all error handlers
   */
  private notifyError(error: Error): void {
    for (const handler of this.errorHandlers) {
      try {
        handler(error);
      } catch (handlerError) {
        logger.error({ error: (handlerError as Error).message }, 'Error handler threw error');
      }
    }
  }

  /**
   * Notify all reconnecting handlers
   */
  private notifyReconnecting(attempt: number, maxAttempts: number): void {
    for (const handler of this.reconnectingHandlers) {
      try {
        handler(attempt, maxAttempts);
      } catch (error) {
        logger.error({ error: (error as Error).message }, 'Reconnecting handler threw error');
      }
    }
  }

  // ============================================================================
  // Reconnection Methods
  // ============================================================================

  /**
   * Check if reconnection should be attempted
   */
  private shouldReconnect(): boolean {
    if (!this.config?.reconnect) {
      return false;
    }

    const maxAttempts = this.config.maxReconnectAttempts ?? DEFAULT_MAX_RECONNECT_ATTEMPTS;
    return this.reconnectAttempts < maxAttempts;
  }

  /**
   * Schedule a reconnection attempt
   */
  private scheduleReconnect(): void {
    if (this.reconnectTimer) {
      return; // Already scheduled
    }

    this.state = ConnectionState.RECONNECTING;
    this.reconnectAttempts++;

    const maxAttempts = this.config?.maxReconnectAttempts ?? DEFAULT_MAX_RECONNECT_ATTEMPTS;
    const interval = this.config?.reconnectInterval ?? DEFAULT_RECONNECT_INTERVAL;

    logger.info(
      { attempt: this.reconnectAttempts, maxAttempts, interval },
      'Scheduling reconnection attempt'
    );

    // Notify reconnecting handlers
    this.notifyReconnecting(this.reconnectAttempts, maxAttempts);

    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;

      try {
        await this.establishConnection();
        logger.info({ attempts: this.reconnectAttempts }, 'Reconnection successful');
      } catch (error) {
        logger.warn({ error: (error as Error).message }, 'Reconnection attempt failed');

        // Schedule another attempt if we haven't reached the limit
        if (this.shouldReconnect()) {
          this.scheduleReconnect();
        } else {
          logger.error({ maxAttempts }, 'Max reconnection attempts reached, giving up');
          this.state = ConnectionState.DISCONNECTED;
          this.notifyError(new Error(`Failed to reconnect after ${maxAttempts} attempts`));
        }
      }
    }, interval);
  }

  /**
   * Clear any pending reconnection timer
   */
  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  // ============================================================================
  // Heartbeat Methods
  // ============================================================================

  /**
   * Start the heartbeat monitoring
   */
  private startHeartbeat(): void {
    this.stopHeartbeat(); // Clear any existing heartbeat

    this.heartbeatInterval = setInterval(() => {
      this.sendPing();
    }, DEFAULT_HEARTBEAT_INTERVAL);

    logger.debug({ interval: DEFAULT_HEARTBEAT_INTERVAL }, 'Heartbeat monitoring started');
  }

  /**
   * Stop the heartbeat monitoring
   */
  private stopHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }

    if (this.heartbeatTimeout) {
      clearTimeout(this.heartbeatTimeout);
      this.heartbeatTimeout = null;
    }

    this.awaitingPong = false;
  }

  /**
   * Send a ping to the peer
   */
  private sendPing(): void {
    if (!this.ws || this.state !== ConnectionState.CONNECTED) {
      return;
    }

    if (this.awaitingPong) {
      // We didn't receive a pong for the previous ping - connection may be dead
      logger.warn('No pong received, connection may be dead');
      this.handleHeartbeatTimeout();
      return;
    }

    this.awaitingPong = true;
    this.ws.ping();

    // Set timeout for pong response
    this.heartbeatTimeout = setTimeout(() => {
      if (this.awaitingPong) {
        this.handleHeartbeatTimeout();
      }
    }, HEARTBEAT_TIMEOUT);

    logger.debug('Ping sent');
  }

  /**
   * Handle pong response from peer
   */
  private handlePong(): void {
    this.awaitingPong = false;

    if (this.heartbeatTimeout) {
      clearTimeout(this.heartbeatTimeout);
      this.heartbeatTimeout = null;
    }

    logger.debug('Pong received');
  }

  /**
   * Handle heartbeat timeout (no pong received)
   */
  private handleHeartbeatTimeout(): void {
    logger.warn('Heartbeat timeout - closing connection');
    this.awaitingPong = false;

    if (this.heartbeatTimeout) {
      clearTimeout(this.heartbeatTimeout);
      this.heartbeatTimeout = null;
    }

    // Close the connection to trigger reconnection if enabled
    if (this.ws) {
      this.ws.terminate();
    }
  }

  // ============================================================================
  // Getters for testing/debugging
  // ============================================================================

  /**
   * Get the current message queue length (for testing)
   */
  getQueueLength(): number {
    return this.messageQueue.length;
  }

  /**
   * Get the number of reconnection attempts (for testing)
   */
  getReconnectAttempts(): number {
    return this.reconnectAttempts;
  }
}
