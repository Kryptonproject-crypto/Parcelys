import { Capacitor } from '@capacitor/core';
import { Geolocation, type Position as PositionNative } from '@capacitor/geolocation';
import { LisseurGps, evaluerReleve, type Releve, type ResultatReleve } from '@commun/gps';
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
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * DEUX RÉGLAGES QUI COMPTENT (0.11.1)
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * **L'intervalle du suivi.** Sur Android, le greffon sert de `timeout` comme
 * intervalle entre deux positions du suivi continu, et de
 * `minimumUpdateInterval` (5 s par défaut) comme plancher. L'application
 * passait 20 s : une position toutes les vingt secondes. Le suivi demande
 * désormais une position par seconde. Dans un navigateur, `timeout` garde son
 * sens ordinaire (délai d'attente d'un point) : on lui laisse 20 s.
 *
 * **Le relevé ponctuel.** Un seul appel à `getCurrentPosition` rend souvent le
 * premier point disponible, avant que les satellites n'aient convergé. Un
 * relevé écoute désormais plusieurs points et en garde les meilleurs
 * (`releverPosition`, logique dans `@commun/gps`).
 */

const NATIF = Capacitor.isNativePlatform();

/** Suivi continu : une position par seconde sur Android. */
const OPTIONS_SUIVI = NATIF
  ? { enableHighAccuracy: true, timeout: 1_000, maximumAge: 0, minimumUpdateInterval: 1_000 }
  : { enableHighAccuracy: true, timeout: 20_000, maximumAge: 0 };

export class GeolocationDenied extends Error {
  constructor(
    message = "L'accès à la position a été refusé. Autorisez-le dans les réglages du téléphone.",
  ) {
    super(message);
    this.name = 'GeolocationDenied';
  }
}

/**
 * Seule la position **approximative** est autorisée.
 *
 * Depuis Android 12, l'utilisateur peut n'accorder qu'une position
 * « approximative » — à quelques centaines de mètres, pour protéger sa vie
 * privée. C'est un bon réglage pour la météo ; pour dire dans quelle parcelle
 * on se trouve, ou tracer un contour, c'est inutilisable. L'application le
 * prenait pour une autorisation suffisante et affichait ensuite des positions
 * fausses sans dire pourquoi.
 */
export class PositionApproximative extends GeolocationDenied {
  constructor() {
    super(
      'Seule la position approximative est autorisée : elle peut être fausse de plusieurs ' +
        'centaines de mètres. Dans les réglages du téléphone (Applications › Parcelys › ' +
        'Autorisations › Position), activez « Utiliser la position exacte ».',
    );
    this.name = 'PositionApproximative';
  }
}

/** Demande l'autorisation ; à appeler avant tout relevé. */
export async function ensurePermission(): Promise<void> {
  let statut;
  try {
    statut = await Geolocation.checkPermissions();
  } catch {
    // Navigateur de développement : `checkPermissions` n'existe pas toujours,
    // l'autorisation est alors demandée au premier relevé.
    return;
  }
  if (statut.location === 'granted') return;

  let demande;
  try {
    demande = await Geolocation.requestPermissions();
  } catch {
    return;
  }
  if (demande.location === 'granted') return;
  if (demande.coarseLocation === 'granted') throw new PositionApproximative();
  throw new GeolocationDenied();
}

function versReleve(position: PositionNative): Releve {
  return {
    lat: position.coords.latitude,
    lng: position.coords.longitude,
    accuracy: position.coords.accuracy,
    timestamp: position.timestamp,
    speed: position.coords.speed ?? null,
  };
}

function versPosition(releve: Releve): Position {
  return {
    lat: releve.lat,
    lng: releve.lng,
    ...(releve.accuracy !== undefined ? { accuracy: releve.accuracy } : {}),
  };
}

/** Message d'erreur du greffon, ou refus d'autorisation reconnu. */
function erreurDuGreffon(erreur: unknown): Error {
  const message =
    erreur && typeof erreur === 'object' && 'message' in erreur
      ? String((erreur as { message: unknown }).message)
      : 'Position indisponible.';
  const code = erreur && typeof erreur === 'object' && 'code' in erreur ? (erreur as { code: unknown }).code : null;
  // Navigateur : code 1 = PERMISSION_DENIED.
  if (code === 1 || /denied|refus/i.test(message)) return new GeolocationDenied();
  return new Error(message);
}

export type ProgresReleve = { precision: number | null; points: number };

/** Délai laissé aux points suivants une fois la précision visée atteinte. */
const ATTENTE_DES_SUIVANTS_MS = 4_000;

/**
 * Relève une position **précise** : écoute le GPS quelques secondes, garde
 * les meilleurs points et en fait la moyenne pondérée.
 *
 * S'arrête dès que `precisionVisee` est atteinte sur `releves` points, ou au
 * bout de `dureeMaxMs` avec le meilleur résultat obtenu — refusé s'il reste
 * moins bon que `precisionMax`. `onProgres` reçoit l'état à chaque point,
 * pour afficher « ±6 m, 3 points » pendant l'attente.
 */
export async function releverPosition(
  options: {
    precisionVisee?: number;
    releves?: number;
    dureeMaxMs?: number;
    precisionMax?: number;
    onProgres?: (progres: ProgresReleve) => void;
  } = {},
): Promise<Position & { releve: ResultatReleve }> {
  const objectif = {
    precisionVisee: options.precisionVisee ?? 10,
    releves: options.releves ?? 3,
  };
  const dureeMax = options.dureeMaxMs ?? 12_000;
  const precisionMax = options.precisionMax ?? 50;

  await ensurePermission();

  return new Promise((resolve, reject) => {
    const points: Releve[] = [];
    let idSuivi: string | null = null;
    let fini = false;
    /**
     * Précision visée atteinte, mais pas encore sur assez de points : on
     * laisse quelques secondes aux suivants, pas davantage. Un récepteur qui
     * ne rend qu'un point (navigateur, téléphone immobile qui économise) ne
     * doit pas faire attendre la fin du délai pour une position déjà bonne.
     */
    let attenteDesSuivants: ReturnType<typeof setTimeout> | null = null;

    const terminer = (issue: () => void) => {
      if (fini) return;
      fini = true;
      clearTimeout(minuteur);
      if (attenteDesSuivants) clearTimeout(attenteDesSuivants);
      if (idSuivi) void Geolocation.clearWatch({ id: idSuivi });
      issue();
    };

    const minuteur = setTimeout(() => {
      const resultat = evaluerReleve(points, objectif);
      terminer(() => {
        if (!resultat) {
          reject(new Error('Aucune position reçue. Sous les arbres ou en bâtiment, le GPS met du temps.'));
        } else if (resultat.precision > precisionMax) {
          reject(
            new Error(
              `Position trop imprécise (±${Math.round(resultat.precision)} m). ` +
                'Attendez que le GPS se stabilise, à découvert.',
            ),
          );
        } else {
          resolve({ ...versPosition(resultat.position), releve: resultat });
        }
      });
    }, dureeMax);

    void Geolocation.watchPosition(OPTIONS_SUIVI, (position, erreur) => {
      if (fini) return;
      if (erreur) {
        // Une erreur avant le moindre point est un échec ; après, on garde ce
        // qu'on a et on laisse le minuteur conclure.
        if (points.length === 0) terminer(() => reject(erreurDuGreffon(erreur)));
        return;
      }
      if (!position) return;
      points.push(versReleve(position));
      const resultat = evaluerReleve(points, objectif);
      options.onProgres?.({ precision: resultat?.precision ?? null, points: resultat?.retenus ?? 0 });
      if (resultat?.atteint) {
        terminer(() => resolve({ ...versPosition(resultat.position), releve: resultat }));
      } else if (resultat && resultat.precision <= objectif.precisionVisee && !attenteDesSuivants) {
        attenteDesSuivants = setTimeout(() => {
          const meilleur = evaluerReleve(points, objectif);
          if (meilleur) terminer(() => resolve({ ...versPosition(meilleur.position), releve: meilleur }));
        }, ATTENTE_DES_SUIVANTS_MS);
      }
    })
      .then((id) => {
        if (fini) void Geolocation.clearWatch({ id });
        else idSuivi = id;
      })
      .catch((erreur: unknown) => terminer(() => reject(erreurDuGreffon(erreur))));
  });
}

/**
 * Une position, pour une question ponctuelle (« où suis-je ? »).
 *
 * C'est un relevé court : jusqu'à 12 s, dix mètres visés sur trois points.
 */
export async function currentPosition(): Promise<Position> {
  const { lat, lng, accuracy } = await releverPosition();
  return { lat, lng, ...(accuracy !== undefined ? { accuracy } : {}) };
}

/**
 * Suit la position en continu, lissée. Renvoie la fonction d'arrêt.
 *
 * Le suivi doit impérativement être arrêté à la sortie de l'écran : laissé
 * actif, il vide la batterie en une heure.
 */
export async function watchPosition(
  onPosition: (position: Position) => void,
  onError?: (message: string) => void,
): Promise<() => void> {
  await ensurePermission();
  const lisseur = new LisseurGps();

  const id = await Geolocation.watchPosition(OPTIONS_SUIVI, (position, error) => {
    if (error) {
      onError?.(erreurDuGreffon(error).message);
      return;
    }
    if (!position) return;
    onPosition(versPosition(lisseur.ajouter(versReleve(position))));
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
