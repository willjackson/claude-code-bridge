/**
 * Transport layer interface and types for Claude Code Bridge
 * Defines the abstract transport interface for communication between bridge instances
 */

import type { BridgeMessage } from '../bridge/protocol.js';

// ============================================================================
// Connection State Enum
// ============================================================================

/**
 * Represents the current state of a transport connection
 */
export enum ConnectionState {
  /** Not connected to any peer */
  DISCONNECTED = 'DISCONNECTED',
  /** Currently attempting to establish connection */
  CONNECTING = 'CONNECTING',
  /** Successfully connected and ready for communication */
  CONNECTED = 'CONNECTED',
  /** Connection lost, attempting to reconnect */
  RECONNECTING = 'RECONNECTING',
}

// ============================================================================
// TLS Configuration
// ============================================================================

/**
 * TLS configuration for secure connections
 */
export interface TLSConfig {
  /** Path to certificate PEM file (for server) */
  cert?: string;
  /** Path to private key PEM file (for server) */
  key?: string;
  /** Path to CA certificate PEM file (for client to verify server, or server to verify client) */
  ca?: string;
  /** Whether to reject unauthorized certificates (default: true) */
  rejectUnauthorized?: boolean;
  /** Passphrase for encrypted private key */
  passphrase?: string;
}

// ============================================================================
// Connection Configuration
// ============================================================================

/**
 * Authentication type
 */
export type AuthType = 'none' | 'token' | 'password' | 'ip' | 'combined';

/**
 * Authentication configuration for transport connections
 */
export interface AuthConfig {
  /** Authentication type */
  type: AuthType;
  /** Authentication token (for type: 'token' or 'combined') */
  token?: string;
  /** Authentication password (for type: 'password' or 'combined') */
  password?: string;
  /** Allowed IP addresses/ranges in CIDR notation (for type: 'ip' or 'combined') */
  allowedIps?: string[];
  /** If true, ALL configured methods must pass; if false, ANY passing method is sufficient */
  requireAll?: boolean;
}

/**
 * Configuration for establishing a transport connection
 */
export interface ConnectionConfig {
  /** Full WebSocket URL (e.g., ws://localhost:8765 or wss://localhost:8765) */
  url?: string;
  /** Host to connect to (used if url is not provided) */
  host?: string;
  /** Port to connect to (used if url is not provided) */
  port?: number;
  /** Enable automatic reconnection on disconnect */
  reconnect?: boolean;
  /** Interval between reconnection attempts in milliseconds */
  reconnectInterval?: number;
  /** Maximum number of reconnection attempts before giving up */
  maxReconnectAttempts?: number;
  /** Authentication configuration */
  auth?: AuthConfig;
  /** TLS configuration for secure connections */
  tls?: TLSConfig;
}

// ============================================================================
// Event Handler Types
// ============================================================================

/**
 * Handler for incoming messages
 */
export type MessageHandler = (message: BridgeMessage) => void;

/**
 * Handler for disconnect events
 */
export type DisconnectHandler = () => void;

/**
 * Handler for error events
 */
export type ErrorHandler = (error: Error) => void;

// ============================================================================
// Transport Interface
// ============================================================================

/**
 * Abstract transport interface for bridge communication
 * Implementations handle the actual network protocol (WebSocket, TCP, etc.)
 */
export interface Transport {
  /**
   * Establish connection to a remote peer
   * @param config Connection configuration
   * @returns Promise that resolves when connection is established
   * @throws Error if connection fails
   */
  connect(config: ConnectionConfig): Promise<void>;

  /**
   * Cleanly close the current connection
   * @returns Promise that resolves when disconnection is complete
   */
  disconnect(): Promise<void>;

  /**
   * Send a message to the connected peer
   * @param message The message to send
   * @returns Promise that resolves when message is sent
   * @throws Error if not connected and message cannot be queued
   */
  send(message: BridgeMessage): Promise<void>;

  /**
   * Register a handler for incoming messages
   * @param handler Function to call when a message is received
   */
  onMessage(handler: MessageHandler): void;

  /**
   * Register a handler for disconnect events
   * @param handler Function to call when connection is lost
   */
  onDisconnect(handler: DisconnectHandler): void;

  /**
   * Register a handler for error events
   * @param handler Function to call when an error occurs
   */
  onError(handler: ErrorHandler): void;

  /**
   * Check if the transport is currently connected
   * @returns true if connected, false otherwise
   */
  isConnected(): boolean;

  /**
   * Get the current connection state
   * @returns The current ConnectionState
   */
  getState(): ConnectionState;
}

// ============================================================================
// Transport Events (for EventEmitter pattern)
// ============================================================================

/**
 * Transport event types for EventEmitter-based implementations
 */
export interface TransportEvents {
  /** Emitted when a message is received */
  message: BridgeMessage;
  /** Emitted when connection is established */
  connect: void;
  /** Emitted when connection is closed */
  disconnect: void;
  /** Emitted when an error occurs */
  error: Error;
  /** Emitted when reconnection is attempted */
  reconnecting: { attempt: number; maxAttempts: number };
}
