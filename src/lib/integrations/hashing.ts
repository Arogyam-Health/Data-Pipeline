import { createHash } from "crypto";

/**
 * Generate a deterministic SHA-256 hash of a request body.
 * Used for duplicate webhook detection.
 */
export function computeRequestHash(body: string): string {
  return createHash("sha256").update(body).digest("hex");
}
