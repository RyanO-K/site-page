/** Where /auth/callback sends the browser when no valid return path was given. */
export const DEFAULT_RETURN = '/#projects';

/** Longest post-login path we will echo back into a Location header. */
const MAX_RETURN_LENGTH = 200;

/**
 * Characters allowed in a return path: the RFC 3986 pchar set plus the
 * delimiters that separate path, query and fragment.
 *
 * This is an allowlist on purpose. Denylisting the obvious attacks is not
 * enough, because browsers strip ASCII tab and newline *before* parsing a URL
 * (WHATWG URL, "basic URL parser"). So "/\t/evil.com" passes a naive
 * "does not start with //" check, and the browser then resolves it as the
 * protocol-relative "//evil.com" — a working open redirect. The same
 * allowlist keeps CR, LF and non-Latin-1 characters out of the Location
 * header, which Node otherwise rejects with ERR_INVALID_CHAR *after* the
 * session cookie has been set, turning a successful login into a 500.
 */
const ALLOWED_PATH_CHARS = /^[A-Za-z0-9\-._~!$&'()*+,;=:@/?#%]*$/;

/** Base used only to resolve the path; never appears in the returned value. */
const RESOLUTION_BASE = 'http://return-path.invalid';

/**
 * Validate a caller-supplied post-login destination.
 *
 * Only same-site absolute paths survive. Anything else — another origin, a
 * protocol-relative URL, a smuggled control character — falls back to
 * DEFAULT_RETURN rather than being sanitised into something half-trusted.
 */
export function safeReturnPath(raw: unknown): string {
  if (typeof raw !== 'string') return DEFAULT_RETURN;
  if (raw.length === 0 || raw.length > MAX_RETURN_LENGTH) return DEFAULT_RETURN;
  if (!raw.startsWith('/')) return DEFAULT_RETURN;
  if (raw.startsWith('//') || raw.startsWith('/\\')) return DEFAULT_RETURN;
  if (!ALLOWED_PATH_CHARS.test(raw)) return DEFAULT_RETURN;

  // Belt and braces: let the URL parser confirm this really is same-origin
  // rather than trusting that the character allowlist covered every trick.
  let resolved: URL;
  try {
    resolved = new URL(raw, RESOLUTION_BASE);
  } catch {
    return DEFAULT_RETURN;
  }
  if (resolved.origin !== RESOLUTION_BASE) return DEFAULT_RETURN;

  return resolved.pathname + resolved.search + resolved.hash;
}
