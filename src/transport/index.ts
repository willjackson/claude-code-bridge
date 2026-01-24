/**
 * Transport module exports
 */

export {
  // Enums
  ConnectionState,
  // Types
  type AuthConfig,
  type ConnectionConfig,
  type MessageHandler,
  type DisconnectHandler,
  type ErrorHandler,
  type Transport,
  type TransportEvents,
} from './interface.js';

export { WebSocketTransport } from './websocket.js';

import { WebSocketTransport } from './websocket.js';
import type { ConnectionConfig, Transport } from './interface.js';

// Transport type for factory function
export type TransportType = 'websocket';

/**
 * Options for creating a transport
 */
export interface CreateTransportOptions {
  /** Configuration to use when connecting */
  config?: ConnectionConfig;
}

/**
 * Factory function to create transport instances
 * @param type The type of transport to create
 * @param options Optional configuration options
 * @returns A Transport instance
 * @throws Error if the transport type is not supported
 */
export function createTransport(type: TransportType, options?: CreateTransportOptions): Transport {
  switch (type) {
    case 'websocket':
      // Config will be passed to connect(), not the constructor
      return new WebSocketTransport();
    default:
      throw new Error(`Unknown transport type: ${type as string}`);
  }
}
