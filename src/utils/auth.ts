/**
 * Authentication utilities for Claude Code Bridge
 * Handles token, password, and IP-based authentication for WebSocket connections
 */

import * as crypto from 'crypto';
import { createLogger } from './logger.js';
import type { IncomingMessage } from 'http';

const logger = createLogger('auth');

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Authentication type
 */
export type AuthType = 'none' | 'token' | 'password' | 'ip' | 'combined';

/**
 * Authentication configuration
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
 * Authentication result
 */
export interface AuthResult {
  /** Whether authentication succeeded */
  success: boolean;
  /** Error message if authentication failed */
  error?: string;
  /** Which authentication method succeeded (if any) */
  method?: 'token' | 'password' | 'ip';
  /** Client IP address */
  clientIp?: string;
}

/**
 * Credentials extracted from a request
 */
export interface ExtractedCredentials {
  /** Token from query string or Authorization header */
  token?: string;
  /** Password from query string or header */
  password?: string;
  /** Client IP address */
  clientIp: string;
}

// ============================================================================
// IP/CIDR Utilities
// ============================================================================

/**
 * Parse an IPv4 address to a 32-bit integer
 */
function ipv4ToInt(ip: string): number {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some(p => isNaN(p) || p < 0 || p > 255)) {
    return -1;
  }
  return (parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3];
}

/**
 * Check if an IP address matches a CIDR range
 * @param clientIp - The IP address to check
 * @param cidr - The CIDR range (e.g., "192.168.0.0/16" or "10.0.0.1")
 * @returns true if the IP matches the range
 */
function matchesCidr(clientIp: string, cidr: string): boolean {
  // Handle IPv6-mapped IPv4 addresses
  let normalizedIp = clientIp;
  if (normalizedIp.startsWith('::ffff:')) {
    normalizedIp = normalizedIp.substring(7);
  }

  // Parse CIDR
  const [network, prefixStr] = cidr.split('/');
  const prefix = prefixStr ? parseInt(prefixStr, 10) : 32;

  // Validate prefix
  if (prefix < 0 || prefix > 32) {
    return false;
  }

  // Parse IP addresses
  const clientInt = ipv4ToInt(normalizedIp);
  const networkInt = ipv4ToInt(network);

  if (clientInt === -1 || networkInt === -1) {
    // If either is invalid, try simple string match
    return normalizedIp === network || clientIp === cidr;
  }

  // Create mask from prefix
  const mask = prefix === 0 ? 0 : (-1 << (32 - prefix)) >>> 0;

  // Compare masked values (use >>> 0 to ensure unsigned comparison)
  return ((clientInt & mask) >>> 0) === ((networkInt & mask) >>> 0);
}

/**
 * Check if an IP address matches any of the allowed ranges
 * @param clientIp - The IP address to check
 * @param allowedCidrs - Array of CIDR ranges
 * @returns true if the IP matches any range
 */
export function validateIp(clientIp: string, allowedCidrs: string[]): boolean {
  if (!allowedCidrs || allowedCidrs.length === 0) {
    return false;
  }

  for (const cidr of allowedCidrs) {
    if (matchesCidr(clientIp, cidr)) {
      logger.debug({ clientIp, matchedCidr: cidr }, 'IP matched allowed range');
      return true;
    }
  }

  logger.debug({ clientIp, allowedCidrs }, 'IP did not match any allowed range');
  return false;
}

// ============================================================================
// Token/Password Validation
// ============================================================================

/**
 * Compare two strings in constant time to prevent timing attacks
 * @param provided - The provided value
 * @param expected - The expected value
 * @returns true if the values match
 */
function timingSafeCompare(provided: string, expected: string): boolean {
  // Ensure both strings have the same length to avoid timing differences
  const providedBuffer = Buffer.from(provided, 'utf-8');
  const expectedBuffer = Buffer.from(expected, 'utf-8');

  // If lengths differ, still do constant-time comparison to prevent timing attack
  // but return false
  if (providedBuffer.length !== expectedBuffer.length) {
    // Compare with expected to maintain constant time
    crypto.timingSafeEqual(expectedBuffer, expectedBuffer);
    return false;
  }

  return crypto.timingSafeEqual(providedBuffer, expectedBuffer);
}

/**
 * Validate a token using timing-safe comparison
 * @param provided - The provided token
 * @param expected - The expected token
 * @returns true if tokens match
 */
export function validateToken(provided: string | undefined, expected: string): boolean {
  if (!provided) {
    return false;
  }
  return timingSafeCompare(provided, expected);
}

/**
 * Validate a password using timing-safe comparison
 * @param provided - The provided password
 * @param expected - The expected password
 * @returns true if passwords match
 */
export function validatePassword(provided: string | undefined, expected: string): boolean {
  if (!provided) {
    return false;
  }
  return timingSafeCompare(provided, expected);
}

// ============================================================================
// Credential Extraction
// ============================================================================

/**
 * Get the client IP address from a request
 * Handles X-Forwarded-For headers for proxied connections
 */
function getClientIp(request: IncomingMessage): string {
  // Check for forwarded IP (from proxy)
  const forwarded = request.headers['x-forwarded-for'];
  if (forwarded) {
    const ips = Array.isArray(forwarded) ? forwarded[0] : forwarded;
    // Get the first IP (original client) from comma-separated list
    const clientIp = ips.split(',')[0].trim();
    if (clientIp) {
      return clientIp;
    }
  }

  // Fall back to socket remote address
  return request.socket.remoteAddress || 'unknown';
}

/**
 * Extract credentials from an HTTP request
 * Looks for token/password in query parameters and Authorization header
 */
export function extractCredentials(request: IncomingMessage): ExtractedCredentials {
  const credentials: ExtractedCredentials = {
    clientIp: getClientIp(request),
  };

  // Parse query parameters from URL
  const url = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`);

  // Extract token from query parameter
  const queryToken = url.searchParams.get('token');
  if (queryToken) {
    credentials.token = queryToken;
  }

  // Extract password from query parameter
  const queryPassword = url.searchParams.get('password');
  if (queryPassword) {
    credentials.password = queryPassword;
  }

  // Check Authorization header (Bearer token takes precedence)
  const authHeader = request.headers.authorization;
  if (authHeader) {
    if (authHeader.startsWith('Bearer ')) {
      credentials.token = authHeader.substring(7);
    } else if (authHeader.startsWith('Basic ')) {
      // Basic auth: base64(username:password) - we use password as auth
      try {
        const decoded = Buffer.from(authHeader.substring(6), 'base64').toString('utf-8');
        const [, password] = decoded.split(':');
        if (password) {
          credentials.password = password;
        }
      } catch {
        // Invalid base64, ignore
      }
    }
  }

  // Check X-Auth-Token header
  const tokenHeader = request.headers['x-auth-token'];
  if (tokenHeader && !credentials.token) {
    credentials.token = Array.isArray(tokenHeader) ? tokenHeader[0] : tokenHeader;
  }

  // Check X-Auth-Password header
  const passwordHeader = request.headers['x-auth-password'];
  if (passwordHeader && !credentials.password) {
    credentials.password = Array.isArray(passwordHeader) ? passwordHeader[0] : passwordHeader;
  }

  return credentials;
}

// ============================================================================
// Authenticator Class
// ============================================================================

/**
 * Authenticator class for validating connection requests
 */
export class Authenticator {
  private config: AuthConfig;

  /**
   * Create a new Authenticator
   * @param config - Authentication configuration
   */
  constructor(config: AuthConfig) {
    this.config = config;
  }

  /**
   * Authenticate a request
   * @param request - The incoming HTTP request (WebSocket upgrade request)
   * @returns Authentication result
   */
  authenticate(request: IncomingMessage): AuthResult {
    // If auth is disabled, allow all connections
    if (this.config.type === 'none') {
      return { success: true };
    }

    // Extract credentials from request
    const credentials = extractCredentials(request);

    return this.authenticateWithCredentials(credentials);
  }

  /**
   * Authenticate with extracted credentials
   * @param credentials - The extracted credentials
   * @returns Authentication result
   */
  authenticateWithCredentials(credentials: ExtractedCredentials): AuthResult {
    const { clientIp } = credentials;

    // If auth is disabled, allow all connections
    if (this.config.type === 'none') {
      return { success: true, clientIp };
    }

    const results: { method: 'token' | 'password' | 'ip'; success: boolean }[] = [];

    // Check token authentication
    if (this.config.token) {
      const tokenValid = validateToken(credentials.token, this.config.token);
      results.push({ method: 'token', success: tokenValid });
      if (tokenValid) {
        logger.debug({ clientIp }, 'Token authentication succeeded');
      } else {
        logger.debug({ clientIp }, 'Token authentication failed');
      }
    }

    // Check password authentication
    if (this.config.password) {
      const passwordValid = validatePassword(credentials.password, this.config.password);
      results.push({ method: 'password', success: passwordValid });
      if (passwordValid) {
        logger.debug({ clientIp }, 'Password authentication succeeded');
      } else {
        logger.debug({ clientIp }, 'Password authentication failed');
      }
    }

    // Check IP authentication
    if (this.config.allowedIps && this.config.allowedIps.length > 0) {
      const ipValid = validateIp(clientIp, this.config.allowedIps);
      results.push({ method: 'ip', success: ipValid });
      if (ipValid) {
        logger.debug({ clientIp }, 'IP authentication succeeded');
      } else {
        logger.debug({ clientIp }, 'IP authentication failed');
      }
    }

    // If no auth methods configured but type is not 'none', reject
    if (results.length === 0) {
      logger.warn('Authentication configured but no methods available');
      return {
        success: false,
        error: 'Authentication required but not configured',
        clientIp,
      };
    }

    // Evaluate results based on requireAll setting
    if (this.config.requireAll) {
      // ALL methods must pass
      const allPassed = results.every(r => r.success);
      if (allPassed) {
        logger.info({ clientIp, methods: results.map(r => r.method) }, 'All authentication methods passed');
        return { success: true, clientIp };
      } else {
        const failed = results.filter(r => !r.success).map(r => r.method);
        logger.warn({ clientIp, failedMethods: failed }, 'Authentication failed (requireAll mode)');
        return {
          success: false,
          error: `Authentication failed for methods: ${failed.join(', ')}`,
          clientIp,
        };
      }
    } else {
      // ANY method passing is sufficient
      const passed = results.find(r => r.success);
      if (passed) {
        logger.info({ clientIp, method: passed.method }, 'Authentication succeeded');
        return { success: true, method: passed.method, clientIp };
      } else {
        logger.warn({ clientIp }, 'All authentication methods failed');
        return {
          success: false,
          error: 'Authentication failed',
          clientIp,
        };
      }
    }
  }

  /**
   * Get the configured authentication type
   */
  getType(): AuthType {
    return this.config.type;
  }

  /**
   * Check if authentication is required
   */
  isRequired(): boolean {
    return this.config.type !== 'none';
  }
}

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Create an AuthConfig from CLI options
 * @param options - CLI options object
 * @returns AuthConfig
 */
export function createAuthConfigFromOptions(options: {
  authToken?: string;
  authPassword?: string;
  authIp?: string[];
  authRequireAll?: boolean;
}): AuthConfig {
  const hasToken = !!options.authToken;
  const hasPassword = !!options.authPassword;
  const hasIp = options.authIp && options.authIp.length > 0;

  // Determine auth type based on what's configured
  let type: AuthType = 'none';
  if (hasToken || hasPassword || hasIp) {
    const count = [hasToken, hasPassword, hasIp].filter(Boolean).length;
    if (count > 1) {
      type = 'combined';
    } else if (hasToken) {
      type = 'token';
    } else if (hasPassword) {
      type = 'password';
    } else if (hasIp) {
      type = 'ip';
    }
  }

  return {
    type,
    token: options.authToken,
    password: options.authPassword,
    allowedIps: options.authIp,
    requireAll: options.authRequireAll ?? false,
  };
}

/**
 * Validate an AuthConfig
 * @param config - AuthConfig to validate
 * @returns Validation result with errors and warnings
 */
export function validateAuthConfig(config: AuthConfig): { valid: boolean; errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Check that required credentials are provided for the auth type
  if (config.type === 'token' && !config.token) {
    errors.push('Token authentication requires a token');
  }
  if (config.type === 'password' && !config.password) {
    errors.push('Password authentication requires a password');
  }
  if (config.type === 'ip' && (!config.allowedIps || config.allowedIps.length === 0)) {
    errors.push('IP authentication requires at least one allowed IP/CIDR');
  }

  // Validate CIDR formats
  if (config.allowedIps) {
    for (const cidr of config.allowedIps) {
      const [ip, prefix] = cidr.split('/');
      if (ipv4ToInt(ip) === -1) {
        warnings.push(`IP address may not be valid IPv4: ${ip}`);
      }
      if (prefix !== undefined) {
        const prefixNum = parseInt(prefix, 10);
        if (isNaN(prefixNum) || prefixNum < 0 || prefixNum > 32) {
          errors.push(`Invalid CIDR prefix: ${cidr}`);
        }
      }
    }
  }

  // Warn about weak authentication
  if (config.token && config.token.length < 16) {
    warnings.push('Token is shorter than 16 characters - consider using a longer token');
  }
  if (config.password && config.password.length < 8) {
    warnings.push('Password is shorter than 8 characters - consider using a longer password');
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}
