import bcrypt from 'bcryptjs';
import { getEnv } from '@/lib/env';

/**
 * Hachage des mots de passe.
 *
 * Argon2id est utilisé lorsque le binaire natif `@node-rs/argon2` est
 * installable sur la plateforme (dépendance optionnelle). Sinon, on retombe sur
 * bcrypt — implémentation pure JS, donc portable (Raspberry Pi 32 bits inclus).
 * Les empreintes étant auto-descriptives (`$argon2id$…` vs `$2b$…`), la
 * vérification reste correcte même après un changement d'algorithme.
 */

type Argon2Module = {
  hash: (password: string) => Promise<string>;
  verify: (hash: string, password: string) => Promise<boolean>;
};

let argon2Promise: Promise<Argon2Module | null> | null = null;

async function loadArgon2(): Promise<Argon2Module | null> {
  if (!argon2Promise) {
    argon2Promise = import('@node-rs/argon2')
      .then((mod) => ({
        hash: (password: string) => mod.hash(password),
        verify: (hash: string, password: string) => mod.verify(hash, password),
      }))
      .catch(() => null);
  }
  return argon2Promise;
}

export async function hashPassword(plain: string): Promise<string> {
  const argon2 = await loadArgon2();
  if (argon2) return argon2.hash(plain);
  return bcrypt.hash(plain, getEnv().PASSWORD_HASH_COST);
}

export async function verifyPassword(
  plain: string,
  hash: string,
): Promise<boolean> {
  if (hash.startsWith('$argon2')) {
    const argon2 = await loadArgon2();
    if (!argon2) return false;
    try {
      return await argon2.verify(hash, plain);
    } catch {
      return false;
    }
  }
  try {
    return await bcrypt.compare(plain, hash);
  } catch {
    return false;
  }
}

/** Empreinte factice utilisée pour égaliser le temps de réponse lorsqu'aucun
 *  compte ne correspond (limite l'énumération d'adresses e-mail). */
const DUMMY_HASH = '$2b$12$C6UzMDM.H6dfI/f/IKcEeO1ZL0kQpV0uJb2HPWQ4Ll5xVQ0jU3vSq';

export async function fakeVerify(plain: string): Promise<void> {
  await bcrypt.compare(plain, DUMMY_HASH).catch(() => false);
}
