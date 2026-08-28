import {
  randomBytes,
  scrypt as _scrypt,
  timingSafeEqual,
  type ScryptOptions,
} from "node:crypto";

function scrypt(
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
  options: ScryptOptions,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    _scrypt(password, salt, keylen, options, (err, derivedKey) => {
      if (err) reject(err);
      else resolve(derivedKey as Buffer);
    });
  });
}

// scrypt parameters. N=2^15 is a reasonable interactive cost for a login flow.
const KEYLEN = 64;
const COST = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

/**
 * Hash a plaintext password. Format: scrypt$N$r$p$saltB64$hashB64
 * Passwords are never stored or logged in plaintext anywhere in this codebase.
 */
export async function hashPassword(plain: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = (await scrypt(plain.normalize("NFKC"), salt, KEYLEN, COST)) as Buffer;
  return [
    "scrypt",
    COST.N,
    COST.r,
    COST.p,
    salt.toString("base64"),
    derived.toString("base64"),
  ].join("$");
}

export async function verifyPassword(
  plain: string,
  stored: string,
): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [, nStr, rStr, pStr, saltB64, hashB64] = parts;
  const N = Number(nStr);
  const r = Number(rStr);
  const p = Number(pStr);
  if (!Number.isFinite(N) || !Number.isFinite(r) || !Number.isFinite(p)) return false;

  const salt = Buffer.from(saltB64!, "base64");
  const expected = Buffer.from(hashB64!, "base64");
  const derived = (await scrypt(plain.normalize("NFKC"), salt, expected.length, {
    N,
    r,
    p,
    maxmem: 64 * 1024 * 1024,
  })) as Buffer;

  return derived.length === expected.length && timingSafeEqual(derived, expected);
}

/** Basic password policy. Enforced server-side on register + password change. */
export function passwordPolicyError(plain: string): string | null {
  if (plain.length < 12) return "Password must be at least 12 characters";
  if (plain.length > 200) return "Password must be at most 200 characters";
  if (!/[a-z]/.test(plain)) return "Password must contain a lowercase letter";
  if (!/[A-Z]/.test(plain)) return "Password must contain an uppercase letter";
  if (!/[0-9]/.test(plain)) return "Password must contain a digit";
  return null;
}
