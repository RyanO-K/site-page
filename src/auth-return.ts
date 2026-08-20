/** Where /auth/callback sends the browser when no valid return path was given. */
export const DEFAULT_RETURN = '/#projects';

/** Longest post-login path we will echo back into a Location header. */
const MAX_RETURN_LENGTH = 200;

/**
 * Validate a caller-supplied post-login destination.
 *
 * Only same-site absolute paths are allowed. "//evil.com" and "/\evil.com"
 * start with a slash but browsers resolve them as protocol-relative URLs to
 * another origin, so accepting them would make /auth/callback an open redirect.
 */
export function safeReturnPath(raw: unknown): string {
  if (typeof raw !== 'string') return DEFAULT_RETURN;
  if (raw.length === 0 || raw.length > MAX_RETURN_LENGTH) return DEFAULT_RETURN;
  if (!raw.startsWith('/')) return DEFAULT_RETURN;
  if (raw.startsWith('//') || raw.startsWith('/\\')) return DEFAULT_RETURN;
  return raw;
}
