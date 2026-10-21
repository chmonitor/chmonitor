/**
 * Environment detection utilities for conditional behavior based on NODE_ENV
 * Works in both server and client components
 */

/**
 * Get NODE_ENV in a way that works in both server and client components
 * In client components, we check typeof window to detect browser environment
 */
function getNodeEnv(): string {
  if (typeof window === 'undefined') {
    return process.env.NODE_ENV || 'development'
  }

  // Client-side: the bundler (Vite) replaces process.env.NODE_ENV at build time
  return process.env.NODE_ENV || 'production'
}

/**
 * Check if running in development environment
 */
export function isDevelopment(): boolean {
  return getNodeEnv() === 'development'
}

/**
 * Check if running in production environment
 */
export function isProduction(): boolean {
  return getNodeEnv() === 'production'
}

/**
 * Check if running in test environment
 */
export function isTest(): boolean {
  return getNodeEnv() === 'test'
}

/**
 * Determine if detailed error information should be shown
 * Returns true in development, false in production
 */
export function shouldShowDetailedErrors(): boolean {
  return isDevelopment()
}

export function getEnvironment(): string {
  return getNodeEnv()
}
