import { Geolocation } from '@capacitor/geolocation';
import type { Position } from './types';

/**
 * Accès au GPS.
 *
 * Le greffon Capacitor s'appuie sur l'API native sur Android et retombe sur
 * `navigator.geolocation` dans un navigateur : le même code fonctionne pendant
 * le développement et dans l'APK.
 *
 * `enableHighAccuracy` est indispensable ici : sans lui, Android répond par une
 * position réseau à plusieurs centaines de mètres, inutilisable pour tracer un
 * contour de parcelle.
 */

const HIGH_ACCURACY = {
  enableHighAccuracy: true,
  timeout: 20_000,
  maximumAge: 0,
} as const;

export class GeolocationDenied extends Error {
  constructor() {
    super(
      "L'accès à la position a été refusé. Autorisez-le dans les réglages du téléphone.",
    );
    this.name = 'GeolocationDenied';
  }
}

/** Demande l'autorisation ; à appeler avant tout relevé. */
export async function ensurePermission(): Promise<void> {
  try {
    const status = await Geolocation.checkPermissions();
    if (status.location === 'granted' || status.coarseLocation === 'granted') return;

    const requested = await Geolocation.requestPermissions();
    if (requested.location !== 'granted' && requested.coarseLocation !== 'granted') {
      throw new GeolocationDenied();
    }
  } catch (error) {
    if (error instanceof GeolocationDenied) throw error;
    // Navigateur de développement : `checkPermissions` n'existe pas toujours,
    // l'autorisation est alors demandée au premier relevé.
  }
}

export async function currentPosition(): Promise<Position> {
  await ensurePermission();
  const position = await Geolocation.getCurrentPosition(HIGH_ACCURACY);
  return {
    lat: position.coords.latitude,
    lng: position.coords.longitude,
    accuracy: position.coords.accuracy,
  };
}

/**
 * Suit la position en continu. Renvoie la fonction d'arrêt.
 *
 * Le suivi doit impérativement être arrêté à la sortie de l'écran : laissé
 * actif, il vide la batterie en une heure.
 */
export async function watchPosition(
  onPosition: (position: Position) => void,
  onError?: (message: string) => void,
): Promise<() => void> {
  await ensurePermission();

  const id = await Geolocation.watchPosition(HIGH_ACCURACY, (position, error) => {
    if (error) {
      onError?.(error.message);
      return;
    }
    if (!position) return;
    onPosition({
      lat: position.coords.latitude,
      lng: position.coords.longitude,
      accuracy: position.coords.accuracy,
    });
  });

  return () => {
    void Geolocation.clearWatch({ id });
  };
}

/** Qualification lisible de la précision annoncée par le GPS. */
export function accuracyLabel(accuracy: number | undefined): {
  text: string;
  tone: 'good' | 'fair' | 'poor';
} {
  if (accuracy === undefined) return { text: 'précision inconnue', tone: 'poor' };
  if (accuracy <= 8) return { text: `±${Math.round(accuracy)} m`, tone: 'good' };
  if (accuracy <= 20) return { text: `±${Math.round(accuracy)} m`, tone: 'fair' };
  return { text: `±${Math.round(accuracy)} m`, tone: 'poor' };
}
