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

export async function loadServerUrl(): Promise<string> {
  const { value } = await Preferences.get({ key: SERVER_KEY });
  return value ?? '';
}

export async function saveServerUrl(url: string): Promise<void> {
  await Preferences.set({ key: SERVER_KEY, value: url });
}

/**
 * Normalise l'adresse saisie par l'utilisateur.
 *
 * Sur un Raspberry Pi, on tape souvent « 192.168.1.42:3000 » ou
 * « parcelys.local » : on complète le schéma et on retire la barre finale, qui
 * produirait sinon des URL à double barre.
 */
export function normalizeServerUrl(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return '';
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  return withScheme.replace(/\/+$/, '');
}
