/* The cryptography behind locked threads. Everything here runs in the tab
   and nothing here ever talks to a server — that separation is the whole
   feature, so keep it that way.

   The shape:
     - Every locked thread owns one random 256-bit AES-GCM content key.
       Message bodies and the thread's real title are sealed with it.
     - That content key is never stored bare. It's wrapped twice: once
       under a key stretched from the user's password, once under a key
       derived from a printed recovery code. Either wrapping opens the
       thread; neither reveals the other.
     - Wrapping is AES-GCM, so a wrong password fails the authentication
       tag. There's no separate "is this right?" check to get wrong, and a
       stolen envelope tells an attacker nothing but its own length.

   The server stores the two wrappings, the salt and the iteration count.
   It never sees the password, the recovery code, or the content key. */

/** Marks a sealed blob and pins the format, so a future version can be
 *  told apart from this one instead of failing as corruption. */
const ENVELOPE_PREFIX = "wlk1";

/** PBKDF2 rounds for password stretching. Current OWASP guidance for
 *  PBKDF2-HMAC-SHA256; ~0.4s on a mid-range laptop, which is the point.
 *  Stored per thread so raising it later leaves old threads openable. */
export const KDF_ITERATIONS = 600_000;

const SALT_BYTES = 16;
const IV_BYTES = 12;
/** 200 bits of recovery code — high entropy, so it skips the stretching
 *  a typed password needs. 25 bytes divides evenly into base32's 5-bit
 *  groups, which is what makes the printed code land on clean chunks. */
const RECOVERY_BYTES = 25;

/** What the server holds for a locked thread. Opaque to it, all of it. */
export type LockEnvelope = {
  version: 1;
  /** base64url, `SALT_BYTES` long. */
  salt: string;
  iterations: number;
  /** The content key under the password-stretched key. */
  passwordWrapped: string;
  /** The content key under the recovery code. */
  recoveryWrapped: string;
};

/** Web Crypto only exists in a secure context: HTTPS, or localhost. Opened
 *  over plain HTTP on a LAN address or a machine name, `crypto.subtle` is
 *  simply undefined, and every call below would die on a property read. Say
 *  what is actually wrong instead. */
function subtle(): SubtleCrypto {
  if (typeof crypto === "undefined" || !crypto.subtle) {
    throw new Error(
      "Locked chats need a secure connection. Open Whirl over HTTPS, or on localhost.",
    );
  }
  return crypto.subtle;
}

/* ---- bytes ---------------------------------------------------------- */

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(value: string): Uint8Array<ArrayBuffer> {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(padded.padEnd(Math.ceil(padded.length / 4) * 4, "="));
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let index = 0; index < binary.length; index++) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function randomBytes(length: number): Uint8Array<ArrayBuffer> {
  return crypto.getRandomValues(new Uint8Array(new ArrayBuffer(length)));
}

/* ---- key derivation ------------------------------------------------- */

/** Stretch a typed password into a wrapping key. Deliberately slow. */
async function keyFromPassword(
  password: string,
  salt: Uint8Array,
  iterations: number,
): Promise<CryptoKey> {
  const material = await subtle().importKey(
    "raw",
    new TextEncoder().encode(password.normalize("NFKC")),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return subtle().deriveKey(
    { name: "PBKDF2", salt: salt as BufferSource, iterations, hash: "SHA-256" },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["wrapKey", "unwrapKey"],
  );
}

/** Derive a wrapping key from recovery code bytes. HKDF, not PBKDF2: the
 *  code is machine-generated and already has more entropy than stretching
 *  could ever add, so making the user wait for it would be theater. */
async function keyFromRecoveryBytes(
  raw: Uint8Array,
  salt: Uint8Array,
): Promise<CryptoKey> {
  const material = await subtle().importKey(
    "raw",
    raw as BufferSource,
    "HKDF",
    false,
    ["deriveKey"],
  );
  return subtle().deriveKey(
    {
      name: "HKDF",
      salt: salt as BufferSource,
      info: new TextEncoder().encode("whirl.locked-thread.recovery.v1"),
      hash: "SHA-256",
    },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["wrapKey", "unwrapKey"],
  );
}

/* ---- the content key ------------------------------------------------ */

/** Extractable on purpose — it has to be wrapped under two different keys,
 *  and re-wrapped whenever the password changes. It only ever exists in
 *  this tab's memory; anything that could read it out could equally read
 *  the decrypted messages off the screen. */
async function generateContentKey(): Promise<CryptoKey> {
  return subtle().generateKey({ name: "AES-GCM", length: 256 }, true, [
    "encrypt",
    "decrypt",
  ]);
}

async function wrapContentKey(
  contentKey: CryptoKey,
  wrappingKey: CryptoKey,
): Promise<string> {
  const iv = randomBytes(IV_BYTES);
  const wrapped = await subtle().wrapKey("raw", contentKey, wrappingKey, {
    name: "AES-GCM",
    iv,
  });
  return `${toBase64Url(iv)}.${toBase64Url(new Uint8Array(wrapped))}`;
}

async function unwrapContentKey(
  blob: string,
  wrappingKey: CryptoKey,
): Promise<CryptoKey> {
  const [ivPart, wrappedPart] = blob.split(".");
  if (!ivPart || !wrappedPart) throw new Error("Malformed key envelope.");
  return subtle().unwrapKey(
    "raw",
    fromBase64Url(wrappedPart) as BufferSource,
    wrappingKey,
    { name: "AES-GCM", iv: fromBase64Url(ivPart) },
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt", "decrypt"],
  );
}

/* ---- sealing content ------------------------------------------------ */

/** Seal a string into a `wlk1.iv.ciphertext` blob. */
export async function seal(
  contentKey: CryptoKey,
  plaintext: string,
): Promise<string> {
  const iv = randomBytes(IV_BYTES);
  const sealed = await subtle().encrypt(
    { name: "AES-GCM", iv },
    contentKey,
    new TextEncoder().encode(plaintext),
  );
  return `${ENVELOPE_PREFIX}.${toBase64Url(iv)}.${toBase64Url(
    new Uint8Array(sealed),
  )}`;
}

/** Open a blob `seal` produced. Throws if the key is wrong or the blob was
 *  tampered with — AES-GCM authenticates, so those are the same failure. */
export async function open(
  contentKey: CryptoKey,
  envelope: string,
): Promise<string> {
  const [prefix, ivPart, sealedPart] = envelope.split(".");
  if (prefix !== ENVELOPE_PREFIX || !ivPart || !sealedPart) {
    throw new Error("Not a sealed message.");
  }
  const plain = await subtle().decrypt(
    { name: "AES-GCM", iv: fromBase64Url(ivPart) },
    contentKey,
    fromBase64Url(sealedPart) as BufferSource,
  );
  return new TextDecoder().decode(plain);
}

/** True for anything `seal` wrote. Cheap enough to call per message row. */
export function isSealed(value: string): boolean {
  return value.startsWith(`${ENVELOPE_PREFIX}.`);
}

/* ---- the recovery code ---------------------------------------------- */

/* Crockford's base32: no I, L, O or U, so nothing in a printed code can be
   mistaken for a digit and nothing can spell a word by accident. */
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const GROUP = 5;

/** Fold a typed code back to its canonical letters: case, spacing and
 *  dashes all wash out, and the four ambiguous glyphs land where a person
 *  reading a printout meant them to. */
export function normalizeRecoveryCode(input: string): string {
  return input
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, "")
    .replace(/O/g, "0")
    .replace(/[IL]/g, "1")
    .replace(/U/g, "V");
}

function encodeBase32(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

function decodeBase32(code: string): Uint8Array<ArrayBuffer> {
  const bytes: number[] = [];
  let bits = 0;
  let value = 0;
  for (const character of code) {
    const index = ALPHABET.indexOf(character);
    if (index < 0) {
      throw new Error("The recovery key contains an unknown character.");
    }
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  const out = new Uint8Array(new ArrayBuffer(bytes.length));
  out.set(bytes);
  return out;
}

/** How many letters a valid code carries, dashes aside. */
export const RECOVERY_CODE_LENGTH = Math.ceil((RECOVERY_BYTES * 8) / 5);

/** Dash-grouped for reading aloud and typing back: XXXXX-XXXXX-… */
export function formatRecoveryCode(code: string): string {
  return (code.match(new RegExp(`.{1,${GROUP}}`, "g")) ?? []).join("-");
}

/* ---- the operations the UI actually calls ---------------------------- */

export type NewLock = {
  envelope: LockEnvelope;
  contentKey: CryptoKey;
  /** Shown once, on the recovery step, and never recoverable after that. */
  recoveryCode: string;
};

/** Mint a fresh lock: a new content key, a password wrapping, and a
 *  recovery code that wraps the same key a second way. */
export async function createLock(password: string): Promise<NewLock> {
  const salt = randomBytes(SALT_BYTES);
  const recoveryRaw = randomBytes(RECOVERY_BYTES);
  const contentKey = await generateContentKey();
  const [passwordKey, recoveryKey] = await Promise.all([
    keyFromPassword(password, salt, KDF_ITERATIONS),
    keyFromRecoveryBytes(recoveryRaw, salt),
  ]);
  const [passwordWrapped, recoveryWrapped] = await Promise.all([
    wrapContentKey(contentKey, passwordKey),
    wrapContentKey(contentKey, recoveryKey),
  ]);
  return {
    envelope: {
      version: 1,
      salt: toBase64Url(salt),
      iterations: KDF_ITERATIONS,
      passwordWrapped,
      recoveryWrapped,
    },
    contentKey,
    recoveryCode: encodeBase32(recoveryRaw),
  };
}

/** The one error every unlock path throws, so callers can say the same
 *  plain thing whichever door was tried. */
export class WrongKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WrongKeyError";
  }
}

export async function openLockWithPassword(
  envelope: LockEnvelope,
  password: string,
): Promise<CryptoKey> {
  const wrappingKey = await keyFromPassword(
    password,
    fromBase64Url(envelope.salt),
    envelope.iterations,
  );
  try {
    return await unwrapContentKey(envelope.passwordWrapped, wrappingKey);
  } catch {
    throw new WrongKeyError("The password is not correct.");
  }
}

export async function openLockWithRecoveryCode(
  envelope: LockEnvelope,
  typedCode: string,
): Promise<CryptoKey> {
  const code = normalizeRecoveryCode(typedCode);
  if (code.length !== RECOVERY_CODE_LENGTH) {
    throw new WrongKeyError(
      `A recovery key has ${RECOVERY_CODE_LENGTH} characters. You entered ${code.length}.`,
    );
  }
  let wrappingKey: CryptoKey;
  try {
    wrappingKey = await keyFromRecoveryBytes(
      decodeBase32(code),
      fromBase64Url(envelope.salt),
    );
  } catch (error) {
    throw new WrongKeyError(
      error instanceof Error ? error.message : "The recovery key is not valid.",
    );
  }
  try {
    return await unwrapContentKey(envelope.recoveryWrapped, wrappingKey);
  } catch {
    throw new WrongKeyError("The recovery key is not correct.");
  }
}

/** Re-wrap an already-open content key under a new password. The salt
 *  stays put: the recovery wrapping was derived against it, and moving it
 *  would silently void a code the user may have already printed. A new
 *  password gets a new wrapping IV, which is what actually matters. */
export async function rewrapWithPassword(
  envelope: LockEnvelope,
  contentKey: CryptoKey,
  password: string,
): Promise<LockEnvelope> {
  const wrappingKey = await keyFromPassword(
    password,
    fromBase64Url(envelope.salt),
    KDF_ITERATIONS,
  );
  return {
    ...envelope,
    iterations: KDF_ITERATIONS,
    passwordWrapped: await wrapContentKey(contentKey, wrappingKey),
  };
}

/* ---- password strength ----------------------------------------------

   Advisory only. There is no minimum length and no floor to clear: a
   locked chat belongs to one person, and how much they want to protect it
   is theirs to decide. What the meter owes them is an honest read, not a
   veto. */

export type PasswordStrength = {
  /** 0–4, the usual five-stop scale. */
  score: number;
  label: string;
  /** What would help most, or null once it's genuinely strong. */
  hint: string | null;
};

/** A deliberately small estimator: length carries most of the weight,
 *  variety adds to it, and the obvious junk passwords are called out by
 *  name. Good enough to steer someone, honest enough not to promise more
 *  than a meter can know. */
export function ratePassword(password: string): PasswordStrength {
  if (!password) {
    return {
      score: 0,
      label: "Too short",
      hint: "Use a password you can remember.",
    };
  }
  if (/^(.)\1+$/.test(password) || /^(?:012|123|abc|qwe|password)/i.test(password)) {
    return {
      score: 0,
      label: "Easy to guess",
      hint: "Use a different password.",
    };
  }

  const classes =
    Number(/[a-z]/.test(password)) +
    Number(/[A-Z]/.test(password)) +
    Number(/[0-9]/.test(password)) +
    Number(/[^A-Za-z0-9]/.test(password));
  const lengthScore = password.length >= 20 ? 3 : password.length >= 14 ? 2 : password.length >= 10 ? 1 : 0;
  const score = Math.min(4, Math.max(password.length >= 8 ? 1 : 0, lengthScore + (classes >= 3 ? 1 : 0)));

  const labels = ["Too short", "Weak", "Fair", "Strong", "Very strong"];
  const hint =
    password.length < 8
      ? "Use 8 characters or more."
      : password.length < 14
        ? "Use a longer password."
        : classes < 2
          ? "Add a number or a symbol."
          : null;
  return { score, label: labels[score], hint };
}
