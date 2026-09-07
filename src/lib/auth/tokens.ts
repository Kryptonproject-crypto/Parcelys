import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';

/** Jeton opaque de 32 octets, encodé en base64url. */
export function generateToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

/** Empreinte SHA-256 stockée en base : le jeton clair n'est jamais persisté. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Code numérique à 6 chiffres, tiré avec un générateur cryptographique. */
export function generateNumericCode(length = 6): string {
  let code = '';
  for (let i = 0; i < length; i += 1) code += randomInt(0, 10).toString();
  return code;
}

/** Comparaison à temps constant de deux empreintes hexadécimales. */
export function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
