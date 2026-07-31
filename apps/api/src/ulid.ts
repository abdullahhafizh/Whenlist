/** Crockford Base32 ULID (26 chars). */
const ENCODING = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

function encodeTime(now: number): string {
  let t = now;
  let out = "";
  for (let i = 0; i < 10; i++) {
    out = ENCODING[t % 32]! + out;
    t = Math.floor(t / 32);
  }
  return out;
}

function encodeRandom(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(10));
  let out = "";
  // 80 bits → 16 Crockford chars
  let buffer = 0;
  let bits = 0;
  for (const b of bytes) {
    buffer = (buffer << 8) | b;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      out += ENCODING[(buffer >> bits) & 31]!;
    }
  }
  if (bits > 0) out += ENCODING[(buffer << (5 - bits)) & 31]!;
  return out.slice(0, 16);
}

export function ulid(now = Date.now()): string {
  return encodeTime(now) + encodeRandom();
}
