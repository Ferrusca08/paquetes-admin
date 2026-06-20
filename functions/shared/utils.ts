/**
 * PackTrack — Utility Functions
 */
import { randomInt } from "node:crypto";

/**
 * Generate a cryptographically random 6-digit pickup code.
 * Range: 100000–999999 (always 6 digits).
 */
export function generatePickupCode(): string {
  return randomInt(100_000, 1_000_000).toString();
}

/**
 * Generate a UUID v4-style ID using crypto.
 */
export function generateId(): string {
  return crypto.randomUUID();
}

/**
 * Get the current ISO 8601 timestamp.
 */
export function now(): string {
  return new Date().toISOString();
}

/**
 * Calculate TTL epoch timestamp (seconds) for DynamoDB TTL attribute.
 */
export function ttlEpoch(daysFromNow: number): number {
  return Math.floor(Date.now() / 1000) + daysFromNow * 86400;
}

/**
 * Normalize a name for search:
 * - lowercase
 * - remove diacritics (accents)
 * - trim extra whitespace
 */
export function normalizeName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}
