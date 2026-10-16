/**
 * Précision du GPS au champ : lisser le suivi, moyenner un relevé.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * CE QUI N'ALLAIT PAS
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * 1. **Le suivi ne se rafraîchissait que toutes les 20 secondes.** Sur Android,
 *    le greffon Capacitor sert de l'option `timeout` comme **intervalle** du
 *    suivi continu (`LocationRequest.Builder(timeout)`, vérifié dans le code
 *    compilé de la bibliothèque native). L'application passait 20 000 ms : le
 *    point bleu de la carte et le tracé d'un contour à pied recevaient une
 *    position toutes les vingt secondes. À pied, c'est près de trente mètres
 *    de retard ; sur un tracteur, plus de cent.
 *
 * 2. **Un relevé ponctuel prenait le premier point venu.** « Où suis-je ? » et
 *    « Ajouter ce coin » demandaient une position unique, et le téléphone rend
 *    alors souvent son premier point — celui du réseau, à trente ou cinquante
 *    mètres, avant que les satellites n'aient convergé.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * CE QUE FONT CES FONCTIONS
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *   · `LisseurGps` — filtre de Kalman réduit à la position : chaque point
 *     pèse selon la précision qu'il annonce, et l'incertitude croît avec le
 *     temps écoulé et la vitesse. Le point bleu cesse de sautiller sur place
 *     et un mauvais point isolé ne fait plus faire d'écart au tracé.
 *   · `evaluerReleve` — pour un relevé ponctuel : on écoute plusieurs points,
 *     on ne garde que les meilleurs, on en fait la moyenne pondérée.
 *
 * Ce qu'elles ne font pas : promettre mieux que le récepteur. La précision
 * affichée reste celle **annoncée par le GPS** pour le meilleur point retenu ;
 * moyenner plusieurs points proches dans le temps ne divise pas l'erreur
 * comme le voudrait la statistique (elle est corrélée d'un point à l'autre),
 * et annoncer « ±1 m » ferait croire à une précision que personne n'a.
 *
 * Fonctions pures, sans dépendance au téléphone : testées dans
 * `tests/gps.test.ts`, employées par `mobile/src/lib/geolocation.ts`.
 */

export type Releve = {
  lat: number;
  lng: number;
  /** Rayon de précision annoncé par le récepteur, en mètres. */
  accuracy?: number;
  /** Horodatage du point, en millisecondes. */
  timestamp?: number;
  /** Vitesse annoncée, en m/s, quand le récepteur la donne. */
  speed?: number | null;
};

const METRES_PAR_DEGRE_LAT = 111_320;

function metresParDegreLng(lat: number): number {
  return METRES_PAR_DEGRE_LAT * Math.cos((lat * Math.PI) / 180);
}

/** Distance approchée en mètres — largement suffisante à l'échelle d'une parcelle. */
export function ecartMetres(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const dy = (a.lat - b.lat) * METRES_PAR_DEGRE_LAT;
  const dx = (a.lng - b.lng) * metresParDegreLng((a.lat + b.lat) / 2);
  return Math.hypot(dx, dy);
}

/** Précision supposée d'un point qui n'en annonce aucune : prudente. */
const PRECISION_INCONNUE_M = 30;

// ---------------------------------------------------------------------------
// Suivi continu
// ---------------------------------------------------------------------------

/**
 * Lissage du suivi continu.
 *
 * L'état est la position estimée et sa variance (en m²). À chaque point :
 *
 *   1. la variance croît de (vitesse × durée écoulée)² — on a pu bouger ;
 *   2. le point est fondu dans l'estimation au prorata des variances : un
 *      point annoncé à ±3 m pèse beaucoup plus qu'un point à ±25 m.
 *
 * La vitesse retenue est celle annoncée par le récepteur, avec un plancher
 * (`vitesseMinimale`, la marche) : sans lui, un téléphone posé croirait ne
 * jamais pouvoir bouger et suivrait mal le premier pas.
 *
 * Un point qui tombe très loin de l'estimation alors qu'il est précis
 * (sortie d'un bâtiment, de sous un hangar) **remplace** l'estimation au lieu
 * de s'y fondre : traîner l'ancienne position serait pire que de sauter.
 */
export class LisseurGps {
  private lat = 0;
  private lng = 0;
  private variance = -1;
  private dernier = 0;

  constructor(private readonly vitesseMinimale = 1.5) {}

  reinitialiser(): void {
    this.variance = -1;
  }

  ajouter(releve: Releve): Releve {
    const precision = Math.max(releve.accuracy ?? PRECISION_INCONNUE_M, 1);
    const instant = releve.timestamp ?? Date.now();

    if (this.variance < 0) {
      this.initialiser(releve, precision, instant);
      return releve;
    }

    const duree = Math.max(0, (instant - this.dernier) / 1000);
    const vitesse = Math.max(releve.speed ?? 0, this.vitesseMinimale);
    this.variance += (vitesse * duree) ** 2;
    this.dernier = Math.max(this.dernier, instant);

    // Saut franc : bien au-delà de l'incertitude combinée, et plus précis que
    // l'estimation elle-même.
    const ecart = ecartMetres({ lat: this.lat, lng: this.lng }, releve);
    if (ecart > 4 * Math.sqrt(this.variance + precision ** 2) && precision ** 2 < this.variance) {
      this.initialiser(releve, precision, instant);
      return releve;
    }

    const gain = this.variance / (this.variance + precision ** 2);
    this.lat += gain * (releve.lat - this.lat);
    this.lng += gain * (releve.lng - this.lng);
    this.variance = (1 - gain) * this.variance;

    return {
      ...releve,
      lat: this.lat,
      lng: this.lng,
      // La précision annoncée reste celle du récepteur : voir l'en-tête.
      accuracy: releve.accuracy,
    };
  }

  private initialiser(releve: Releve, precision: number, instant: number): void {
    this.lat = releve.lat;
    this.lng = releve.lng;
    this.variance = precision ** 2;
    this.dernier = instant;
  }
}

// ---------------------------------------------------------------------------
// Relevé ponctuel
// ---------------------------------------------------------------------------

export type ObjectifReleve = {
  /** Précision visée, en mètres : on s'arrête dès qu'elle est atteinte… */
  precisionVisee: number;
  /** …et qu'on a au moins ce nombre de bons points à moyenner. */
  releves: number;
};

export type ResultatReleve = {
  position: Releve;
  /** Points retenus dans la moyenne. */
  retenus: number;
  /** Meilleure précision annoncée parmi eux. */
  precision: number;
  /** L'objectif est-il atteint ? Sinon, c'est le mieux obtenu jusque-là. */
  atteint: boolean;
};

/**
 * Où en est un relevé ponctuel, au vu des points reçus jusqu'ici.
 *
 * Seuls comptent les points proches du meilleur (précision au plus 1,5 fois
 * la sienne, plus un mètre) : un point à ±40 m ne doit pas tirer une moyenne
 * faite de points à ±4 m. Leur moyenne est pondérée par l'inverse du carré de
 * la précision.
 *
 * Rend `null` tant qu'aucun point n'est arrivé.
 */
export function evaluerReleve(points: Releve[], objectif: ObjectifReleve): ResultatReleve | null {
  if (points.length === 0) return null;

  const precisionDe = (p: Releve) => Math.max(p.accuracy ?? PRECISION_INCONNUE_M, 1);
  const meilleure = Math.min(...points.map(precisionDe));
  const seuil = meilleure * 1.5 + 1;
  const retenus = points.filter((p) => precisionDe(p) <= seuil);

  let somme = 0;
  let lat = 0;
  let lng = 0;
  for (const p of retenus) {
    const poids = 1 / precisionDe(p) ** 2;
    somme += poids;
    lat += p.lat * poids;
    lng += p.lng * poids;
  }

  const dernier = retenus[retenus.length - 1];
  return {
    position: {
      lat: lat / somme,
      lng: lng / somme,
      accuracy: meilleure,
      ...(dernier?.timestamp !== undefined ? { timestamp: dernier.timestamp } : {}),
    },
    retenus: retenus.length,
    precision: meilleure,
    atteint: meilleure <= objectif.precisionVisee && retenus.length >= objectif.releves,
  };
}
