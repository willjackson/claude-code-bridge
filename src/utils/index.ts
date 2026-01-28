export { createLogger, createChildLogger, type Logger, type LogLevel } from './logger.js';
export {
  loadConfig,
  loadConfigSync,
  mergeConfig,
  DEFAULT_CONFIG,
  type BridgeConfig,
  type ListenConfig,
  type ConnectConfig,
  type ContextSharingConfig,
  type InteractionConfig,
  type TLSConfig as ConfigTLSConfig,
  type AuthConfig as ConfigAuthConfig,
  type AuthType as ConfigAuthType,
} from './config.js';
export { estimateTokens, truncateToTokenLimit } from './tokens.js';
export {
  BridgeError,
  ConfigurationError,
  ConnectionError,
  PeerError,
  TaskError,
  ContextError,
  ProtocolError,
  BridgeLifecycleError,
  ErrorCodes,
  formatErrorForLogging,
  wrapError,
  isErrorCode,
  type ErrorCode,
} from './errors.js';
export {
  loadCertificates,
  loadCertificatesSync,
  validateTLSConfig,
  isTLSEnabled,
  createSecureContextOptions,
  type TLSConfig,
  type TLSValidationResult,
  type LoadedTLSOptions,
} from './tls.js';
export {
  Authenticator,
  validateToken,
  validatePassword,
  validateIp,
  extractCredentials,
  createAuthConfigFromOptions,
  validateAuthConfig,
  type AuthConfig,
  type AuthType,
  type AuthResult,
  type ExtractedCredentials,
} from './auth.js';
