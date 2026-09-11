import { describe, expect, it } from 'vitest';
import {
  FUSEAU_EXPLOITATION,
  campagneCourante,
  campagneDeLaDate,
  partiesFr,
  periodeCampagne,
  periodeCampagneLabel,
} from '@/lib/shared/campagne';
import { formatDateFr, formatDateLongFr } from '@/components/ui';

/**
 * Le même instant, lu depuis deux machines différentes.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * CE QUE CES CAS PROTÈGENT
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Parcelys tourne aux deux bouts : le serveur rend le HTML, le navigateur de
 * l'exploitant l'hydrate. Le serveur est en UTC — celui de ce dépôt comme
 * celui du Raspberry Pi tel qu'il est livré —, le navigateur à l'heure de
 * Paris.
 *
 * Tant que les dates étaient lues dans le fuseau du processus, les deux ne
 * voyaient pas toujours le même jour. L'audit 0.9.5 l'a repéré par une erreur
 * d'hydratation React (#418) sur /portefeuille ; le dommage réel était
 * ailleurs : le registre phytosanitaire est une pièce opposable, et une date
 * décalée d'un jour n'y est pas un défaut d'affichage.
 *
 * Ces cas emploient donc des instants **juste avant minuit à Paris**, c'est-à-
 * dire encore la veille en UTC. C'est là, et seulement là, que les deux
 * lectures divergent.
 */

/** 11 septembre 2026, 22 h 30 UTC — soit le 12 à 00 h 30 à Paris (UTC+2). */
const VEILLE_EN_UTC = new Date('2026-09-11T22:30:00.000Z');

/** 31 juillet 2027, 23 h 00 UTC — soit le 1ᵉʳ août à 01 h 00 à Paris. */
const BASCULE_DE_CAMPAGNE = new Date('2027-07-31T23:00:00.000Z');

/** 15 janvier 2027, 23 h 30 UTC — heure d'hiver, Paris est à UTC+1. */
const HIVER = new Date('2027-01-15T23:30:00.000Z');

describe('Le fuseau de l’exploitation', () => {
  it('est celui de l’exploitation, pas celui de la machine', () => {
    expect(FUSEAU_EXPLOITATION).toBe('Europe/Paris');
    // Le processus de test n'est pas à Paris : c'est justement ce qui rend
    // ces cas capables d'échouer.
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).not.toBe('Europe/Paris');
  });

  it('lit le jour civil français, pas celui du processus', () => {
    expect(partiesFr(VEILLE_EN_UTC)).toMatchObject({ annee: 2026, mois: 8, jour: 12 });
    // La même date lue par la machine, pour montrer l'écart que l'on corrige.
    expect(VEILLE_EN_UTC.getUTCDate()).toBe(11);
  });

  it('tient compte de l’heure d’hiver comme de l’heure d’été', () => {
    expect(partiesFr(HIVER)).toMatchObject({ annee: 2027, mois: 0, jour: 16 });
    expect(partiesFr(VEILLE_EN_UTC).heure).toBe(0); // UTC+2 en septembre
    expect(partiesFr(HIVER).heure).toBe(0); // UTC+1 en janvier
  });
});

describe('La campagne, comptée à l’heure française', () => {
  it('bascule quand il est le 1ᵉʳ août à Paris, pas quand il l’est à Greenwich', () => {
    // 23 h 00 UTC le 31 juillet : il est déjà le 1ᵉʳ août en France.
    expect(campagneCourante(BASCULE_DE_CAMPAGNE)).toBe(2028);
    // Une heure plus tôt, on est encore le 31 juillet des deux côtés.
    expect(campagneCourante(new Date('2027-07-31T21:00:00.000Z'))).toBe(2027);
  });

  it('ne fait pas changer de campagne une saisie du soir', () => {
    // Le cas qui comptait : une intervention saisie au champ en fin de
    // journée ne doit pas atterrir dans une autre campagne que celle
    // affichée au bureau.
    const auChamp = campagneDeLaDate(VEILLE_EN_UTC);
    const auBureau = campagneCourante(VEILLE_EN_UTC);
    expect(auChamp).toBe(auBureau);
    expect(auChamp).toBe(2027);
  });

  it('borne la campagne sur des instants français, pas sur des minuits UTC', () => {
    const { debut, fin } = periodeCampagne(2027);

    // Le 1ᵉʳ août 2026 commence à 22 h 00 UTC le 31 juillet (Paris est à UTC+2).
    expect(debut.toISOString()).toBe('2026-07-31T22:00:00.000Z');
    expect(partiesFr(debut)).toMatchObject({ annee: 2026, mois: 7, jour: 1, heure: 0 });

    // Et la campagne se termine le 31 juillet 2027.
    expect(partiesFr(fin)).toMatchObject({ annee: 2027, mois: 6, jour: 31 });
  });

  it('affiche la période dans les mêmes termes que le calcul', () => {
    expect(periodeCampagneLabel(2027)).toBe('1ᵉʳ août 2026 → 31 juillet 2027');
  });
});

describe('L’affichage des dates', () => {
  it('rend le jour français, quel que soit le fuseau de la machine', () => {
    // Sans fuseau imposé, cette machine (UTC) aurait rendu « 11/09/2026 »
    // et le navigateur de Kevin « 12/09/2026 » : l'écart que React signalait.
    expect(formatDateFr(VEILLE_EN_UTC)).toBe('12/09/2026');
    expect(formatDateLongFr(VEILLE_EN_UTC)).toBe('12 septembre 2026');
  });

  it('rend la même chose depuis une chaîne ou depuis un objet Date', () => {
    expect(formatDateFr(VEILLE_EN_UTC.toISOString())).toBe(formatDateFr(VEILLE_EN_UTC));
  });

  it('ne fabrique rien quand il n’y a pas de date', () => {
    expect(formatDateFr(null)).toBe('—');
    expect(formatDateFr(undefined)).toBe('—');
    expect(formatDateFr('pas une date')).toBe('—');
  });
});
