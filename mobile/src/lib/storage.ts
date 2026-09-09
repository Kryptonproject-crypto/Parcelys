import { Preferences } from '@capacitor/preferences';
import { Capacitor } from '@capacitor/core';
import type { Session } from './types';

/**
 * Petites valeurs persistantes : session et adresse du serveur.
 *
 * `Preferences` est le stockage natif de Capacitor (SharedPreferences sur
 * Android) : il survit à la fermeture de l'application et au nettoyage du cache
 * de la WebView, contrairement à `localStorage`. En développement dans un
 * navigateur, le greffon retombe automatiquement sur `localStorage`.
 */

const SESSION_KEY = 'parcelys.session';
const SERVER_KEY = 'parcelys.serverUrl';
const FARM_KEY = 'parcelys.farmId';

export const isNative = (): boolean => Capacitor.isNativePlatform();

export async function loadSession(): Promise<Session | null> {
  const { value } = await Preferences.get({ key: SESSION_KEY });
  if (!value) return null;
  try {
    return JSON.parse(value) as Session;
  } catch {
    return null;
  }
}

export async function saveSession(session: Session): Promise<void> {
  await Preferences.set({ key: SESSION_KEY, value: JSON.stringify(session) });
}

export async function clearSession(): Promise<void> {
  await Preferences.remove({ key: SESSION_KEY });
}

/**
 * Exploitation ouverte la dernière fois.
 *
 * L'expert agronomique suit plusieurs domaines : au redémarrage, il retrouve
 * celui qu'il visitait, y compris sans réseau.
 */
export async function loadActiveFarmId(): Promise<string | null> {
  const { value } = await Preferences.get({ key: FARM_KEY });
  return value ?? null;
}

export async function saveActiveFarmId(farmId: string | null): Promise<void> {
  if (farmId) await Preferences.set({ key: FARM_KEY, value: farmId });
  else await Preferences.remove({ key: FARM_KEY });
}

/**
 * Efface l'adresse de serveur conservée par les versions antérieures.
 *
 * Elle était saisie à la connexion ; elle est désormais fixée à la compilation
 * (`lib/config.ts`). La valeur restée en mémoire ne sert plus à rien, et
 * laisser traîner l'adresse d'une instance dans le stockage d'un téléphone
 * n'aurait aucune raison d'être.
 */
export async function forgetLegacyServerUrl(): Promise<void> {
  await Preferences.remove({ key: SERVER_KEY });
}
