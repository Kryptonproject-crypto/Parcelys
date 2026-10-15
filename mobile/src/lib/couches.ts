import {
  ApiError,
  fetchCouchesCarte,
  fetchGeometriesCouche,
  OfflineError,
  type CoucheCarte,
  type EntiteCarte,
} from './api';
import { readCached, writeCached } from './db';
import type { Session } from './types';

/**
 * Couches réglementaires de la carte, gardées sur l'appareil.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * POURQUOI LES GARDER
 * ───────────────────────────────────────────────────────────────────────────
 *
 * C'est au bord de la parcelle, cuve pleine, qu'on se demande où passe le
 * ruisseau — et c'est là qu'il n'y a pas de réseau. Les couches sont donc
 * enregistrées à chaque synchronisation, comme les contours, et affichées
 * hors réseau avec la date à laquelle elles ont été reçues.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * CE QUI EST ENREGISTRÉ
 * ───────────────────────────────────────────────────────────────────────────
 *
 * La liste des couches, toujours ; les géométries de celles qu'on affiche —
 * par défaut le réseau hydrographique, les plans d'eau et les surfaces en
 * eau. Les
 * autres se chargent quand on les allume, s'il y a du réseau. L'empreinte
 * renvoyée par le serveur dit si ce qui est enregistré est encore à jour :
 * inchangée, rien n'est retéléchargé.
 */

export type CouchesEnregistrees = {
  farmId: string;
  empreinte: string;
  recuesLe: string;
  couches: CoucheCarte[];
  geometries: Record<string, EntiteCarte[]>;
};

/**
 * Natures affichées tant que l'exploitant n'a rien choisi : l'eau.
 *
 * Le réseau détaillé (tronçons), pas les « cours d'eau » de BD TOPAGE : ces
 * derniers sont les mêmes rivières, réunies bout à bout — les deux allumés
 * dessineraient deux fois le même trait. Les fossés et petits écoulements
 * n'existent, eux, que dans les tronçons.
 */
export const NATURES_AFFICHEES_PAR_DEFAUT = [
  'TRONCON_HYDROGRAPHIQUE',
  'SURFACE_HYDROGRAPHIQUE',
  'PLAN_EAU',
];

const cle = (farmId: string) => `couches:${farmId}`;
const CLE_CHOIX = 'parcelys.carte.couches';

export function lireCouches(farmId: string): Promise<CouchesEnregistrees | null> {
  return readCached<CouchesEnregistrees>(cle(farmId));
}

/**
 * Met à jour les couches enregistrées : la liste, puis les géométries des
 * couches demandées qui manquent (ou toutes, si l'empreinte a changé).
 *
 * Lève `OfflineError` sans réseau : l'appelant garde ce qu'il a.
 */
export function actualiserCouches(
  session: Session,
  farmId: string,
  voulues: (couches: CoucheCarte[]) => string[],
): Promise<CouchesEnregistrees> {
  // Une à la fois par exploitation : la synchronisation et l'ouverture de la
  // carte en lancent chacune une, souvent au même instant. En parallèle,
  // toutes deux téléchargeaient les mêmes géométries ; à la suite, la seconde
  // trouve celles que la première vient d'enregistrer.
  const precedente = enCours.get(farmId) ?? Promise.resolve(null);
  const suivante = precedente
    .catch(() => null)
    .then(() => actualiser(session, farmId, voulues));
  enCours.set(farmId, suivante);
  const liberer = () => {
    if (enCours.get(farmId) === suivante) enCours.delete(farmId);
  };
  suivante.then(liberer, liberer);
  return suivante;
}

const enCours = new Map<string, Promise<CouchesEnregistrees | null>>();

async function actualiser(
  session: Session,
  farmId: string,
  voulues: (couches: CoucheCarte[]) => string[],
): Promise<CouchesEnregistrees> {
  const avant = await lireCouches(farmId);
  const liste = await fetchCouchesCarte(session, farmId);
  const memes = avant?.empreinte === liste.empreinte;

  const geometries: Record<string, EntiteCarte[]> = memes ? { ...avant.geometries } : {};
  for (const code of voulues(liste.couches)) {
    if (geometries[code] || !liste.couches.some((c) => c.code === code)) continue;
    geometries[code] = (await fetchGeometriesCouche(session, farmId, code)).features;
  }

  const apres: CouchesEnregistrees = {
    farmId,
    empreinte: liste.empreinte,
    recuesLe: memes && avant ? avant.recuesLe : new Date().toISOString(),
    couches: liste.couches,
    geometries,
  };
  await writeCached(cle(farmId), apres);
  return apres;
}

/** Les couches que l'exploitant a choisi d'afficher, ou `null` s'il n'a rien choisi. */
export function couchesChoisies(): string[] | null {
  try {
    const brut = localStorage.getItem(CLE_CHOIX);
    const lu: unknown = brut ? JSON.parse(brut) : null;
    return Array.isArray(lu) ? lu.filter((c): c is string => typeof c === 'string') : null;
  } catch {
    return null;
  }
}

export function retenirCouchesChoisies(codes: string[]): void {
  try {
    localStorage.setItem(CLE_CHOIX, JSON.stringify(codes));
  } catch {
    // Le choix n'est pas retenu : la carte reviendra à l'eau seule.
  }
}

/** Les couches à afficher : celles choisies, sinon les couches d'eau. */
export function couchesAAfficher(couches: CoucheCarte[]): string[] {
  const choix = couchesChoisies();
  if (choix) return couches.filter((c) => choix.includes(c.code)).map((c) => c.code);
  return couches.filter((c) => NATURES_AFFICHEES_PAR_DEFAUT.includes(c.kind)).map((c) => c.code);
}

/**
 * Pourquoi les couches n'ont pas pu être actualisées, dit à l'exploitant.
 *
 * Un échec muet laissait la carte sans cours d'eau sans que rien ne dise
 * pourquoi — le cas le plus fréquent étant un serveur pas encore mis à jour.
 */
export function raisonDeLEchec(erreur: unknown): string {
  if (erreur instanceof OfflineError) {
    return erreur.motif === 'delai'
      ? 'Le serveur n’a pas répondu à temps en préparant les couches. Réessayez dans une minute : une fois préparées, elles arrivent tout de suite.'
      : 'Pas de réseau : les couches s’enregistreront sur l’appareil à la prochaine synchronisation.';
  }
  if (erreur instanceof ApiError) {
    if (erreur.status === 404 && erreur.code !== 'NOT_FOUND') {
      return 'Le serveur ne fournit pas encore les couches de la carte : mettez Parcelys à jour sur le Raspberry Pi (version 0.10.0 ou plus récente).';
    }
    if (erreur.status === 401) return 'Session expirée : reconnectez-vous pour charger les couches.';
    if (erreur.status === 403 || erreur.status === 404) {
      return 'Cette exploitation n’est pas accessible depuis ce compte.';
    }
    return `Le serveur a refusé de fournir les couches (${erreur.status}) : ${erreur.message}`;
  }
  return 'Les couches n’ont pas pu être chargées.';
}
