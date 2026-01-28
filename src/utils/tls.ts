/**
 * TLS utilities for Claude Code Bridge
 * Handles loading and validating TLS certificates for secure WebSocket connections
 */

import * as fs from 'fs';
import * as tls from 'tls';
import { createLogger } from './logger.js';

const logger = createLogger('tls');

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * TLS configuration for secure connections
 */
export interface TLSConfig {
  /** Path to certificate PEM file */
  cert?: string;
  /** Path to private key PEM file */
  key?: string;
  /** Path to CA certificate PEM file (for verifying client certs or self-signed server certs) */
  ca?: string;
  /** Whether to reject unauthorized certificates (default: true) */
  rejectUnauthorized?: boolean;
  /** Passphrase for encrypted private key */
  passphrase?: string;
}

/**
 * Result of TLS configuration validation
 */
export interface TLSValidationResult {
  /** Whether the configuration is valid */
  valid: boolean;
  /** List of validation errors */
  errors: string[];
  /** List of validation warnings */
  warnings: string[];
}

/**
 * Loaded TLS options ready for use with https/tls modules
 */
export interface LoadedTLSOptions {
  /** Certificate content */
  cert?: string | Buffer;
  /** Private key content */
  key?: string | Buffer;
  /** CA certificate content */
  ca?: string | Buffer;
  /** Whether to reject unauthorized certificates */
  rejectUnauthorized?: boolean;
  /** Passphrase for encrypted private key */
  passphrase?: string;
}

// ============================================================================
// Certificate Loading
// ============================================================================

/**
 * Read a certificate or key file
 * @param filePath - Path to the file
 * @returns File contents as string
 * @throws Error if file cannot be read
 */
function readCertFile(filePath: string): string {
  try {
    return fs.readFileSync(filePath, 'utf-8');
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code === 'ENOENT') {
      throw new Error(`Certificate file not found: ${filePath}`);
    }
    if (err.code === 'EACCES') {
      throw new Error(`Permission denied reading certificate file: ${filePath}`);
    }
    throw new Error(`Failed to read certificate file ${filePath}: ${err.message}`);
  }
}

/**
 * Load TLS certificates from file paths
 * @param config - TLS configuration with file paths
 * @returns TLS options ready for use with https/tls modules
 * @throws Error if required certificates cannot be loaded
 */
export async function loadCertificates(config: TLSConfig): Promise<LoadedTLSOptions> {
  const options: LoadedTLSOptions = {};

  // Load certificate
  if (config.cert) {
    logger.debug({ path: config.cert }, 'Loading certificate');
    options.cert = readCertFile(config.cert);
  }

  // Load private key
  if (config.key) {
    logger.debug({ path: config.key }, 'Loading private key');
    options.key = readCertFile(config.key);
  }

  // Load CA certificate
  if (config.ca) {
    logger.debug({ path: config.ca }, 'Loading CA certificate');
    options.ca = readCertFile(config.ca);
  }

  // Set reject unauthorized (default: true)
  options.rejectUnauthorized = config.rejectUnauthorized ?? true;

  // Set passphrase if provided
  if (config.passphrase) {
    options.passphrase = config.passphrase;
  }

  logger.info(
    {
      hasCert: !!options.cert,
      hasKey: !!options.key,
      hasCa: !!options.ca,
      rejectUnauthorized: options.rejectUnauthorized,
    },
    'TLS certificates loaded'
  );

  return options;
}

/**
 * Synchronous version of loadCertificates
 * @param config - TLS configuration with file paths
 * @returns TLS options ready for use with https/tls modules
 * @throws Error if required certificates cannot be loaded
 */
export function loadCertificatesSync(config: TLSConfig): LoadedTLSOptions {
  const options: LoadedTLSOptions = {};

  // Load certificate
  if (config.cert) {
    options.cert = readCertFile(config.cert);
  }

  // Load private key
  if (config.key) {
    options.key = readCertFile(config.key);
  }

  // Load CA certificate
  if (config.ca) {
    options.ca = readCertFile(config.ca);
  }

  // Set reject unauthorized (default: true)
  options.rejectUnauthorized = config.rejectUnauthorized ?? true;

  // Set passphrase if provided
  if (config.passphrase) {
    options.passphrase = config.passphrase;
  }

  return options;
}

// ============================================================================
// Validation
// ============================================================================

/**
 * Check if a file exists and is readable
 * @param filePath - Path to check
 * @returns true if file exists and is readable
 */
function isFileReadable(filePath: string): boolean {
  try {
    fs.accessSync(filePath, fs.constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Validate TLS configuration
 * @param config - TLS configuration to validate
 * @returns Validation result with errors and warnings
 */
export function validateTLSConfig(config: TLSConfig): TLSValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Check for server configuration (cert + key required together)
  if (config.cert && !config.key) {
    errors.push('Certificate provided without private key');
  }
  if (config.key && !config.cert) {
    errors.push('Private key provided without certificate');
  }

  // Validate file paths exist and are readable
  if (config.cert) {
    if (!isFileReadable(config.cert)) {
      errors.push(`Certificate file not readable: ${config.cert}`);
    }
  }

  if (config.key) {
    if (!isFileReadable(config.key)) {
      errors.push(`Private key file not readable: ${config.key}`);
    }
  }

  if (config.ca) {
    if (!isFileReadable(config.ca)) {
      errors.push(`CA certificate file not readable: ${config.ca}`);
    }
  }

  // Warn about disabled certificate verification
  if (config.rejectUnauthorized === false) {
    warnings.push('TLS certificate verification is disabled - this is insecure for production use');
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Check if TLS is enabled in the configuration
 * @param config - TLS configuration to check
 * @returns true if TLS should be enabled (cert and key both provided)
 */
export function isTLSEnabled(config?: TLSConfig): boolean {
  if (!config) {
    return false;
  }
  return !!(config.cert && config.key);
}

/**
 * Create TLS secure context options for Node.js tls module
 * @param loaded - Loaded TLS options
 * @returns Options for tls.createSecureContext
 */
export function createSecureContextOptions(loaded: LoadedTLSOptions): tls.SecureContextOptions {
  const options: tls.SecureContextOptions = {};

  if (loaded.cert) {
    options.cert = loaded.cert;
  }
  if (loaded.key) {
    options.key = loaded.key;
  }
  if (loaded.ca) {
    options.ca = loaded.ca;
  }
  if (loaded.passphrase) {
    options.passphrase = loaded.passphrase;
  }

  return options;
}
