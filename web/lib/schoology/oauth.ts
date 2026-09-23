/**
 * OAuth 1.0a request signing for the Schoology REST API.
 *
 * Schoology never adopted OAuth 2. Its API is signed the 2010 way: every
 * request carries an `Authorization: OAuth ...` header whose parameters are
 * sorted, percent-encoded, joined into a signature base string, and signed with
 * HMAC-SHA1. There is no library dependency here because the whole algorithm is
 * eighty lines and pulling in a generic OAuth client to do it would be more
 * code to audit, not less.
 *
 * This is the *two-legged* flow: the district issues a key and secret to an
 * account, and requests signed with them act as that account. There is no user
 * authorization round trip and no token to refresh — which is why the whole
 * client is stateless.
 */

/**
 * RFC 3986 percent-encoding.
 *
 * `encodeURIComponent` leaves `! * ' ( )` alone; OAuth requires them encoded,
 * and a signature computed over a differently-escaped string simply fails with
 * a 401 that says nothing about why.
 */
function rfc3986(value: string): string {
  return encodeURIComponent(value).replace(
    /[!*'()]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`
  );
}

async function hmacSha1(key: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    enc.encode(key),
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", cryptoKey, enc.encode(message));
  // btoa over a binary string: the runtime has no Buffer guarantee on edge.
  let binary = "";
  for (const byte of new Uint8Array(signature)) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function nonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export interface SchoologyKeys {
  key: string;
  secret: string;
}

/**
 * The `Authorization` header for one request.
 *
 * Query parameters are part of what gets signed, so the caller passes the URL
 * it is actually going to fetch — signing a bare path and then appending
 * `?limit=200` produces a valid-looking header that the API rejects.
 */
export async function authorizationHeader(
  method: "GET" | "POST" | "PUT" | "DELETE",
  url: string,
  keys: SchoologyKeys
): Promise<string> {
  const parsed = new URL(url);

  const oauthParams: Record<string, string> = {
    oauth_consumer_key: keys.key,
    oauth_nonce: nonce(),
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
    oauth_version: "1.0",
  };

  // Everything in the query string signs alongside the oauth_* parameters.
  const signing: [string, string][] = Object.entries(oauthParams);
  parsed.searchParams.forEach((value, name) => signing.push([name, value]));

  // Sorted by encoded name, then encoded value — the spec's ordering, and the
  // one place a "close enough" implementation silently produces 401s.
  const normalized = signing
    .map(([n, v]) => [rfc3986(n), rfc3986(v)] as const)
    .sort((a, b) => (a[0] === b[0] ? (a[1] < b[1] ? -1 : 1) : a[0] < b[0] ? -1 : 1))
    .map(([n, v]) => `${n}=${v}`)
    .join("&");

  // The base string signs the URL without its query, which normalized carries.
  const bare = `${parsed.origin}${parsed.pathname}`;
  const base = [method.toUpperCase(), rfc3986(bare), rfc3986(normalized)].join("&");

  // Two-legged: no token secret, but the trailing "&" is still required.
  const signature = await hmacSha1(`${rfc3986(keys.secret)}&`, base);

  const header = { ...oauthParams, oauth_signature: signature };
  return `OAuth ${Object.entries(header)
    .map(([n, v]) => `${rfc3986(n)}="${rfc3986(v)}"`)
    .join(",")}`;
}
