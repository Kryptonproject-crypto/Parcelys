import 'server-only';
import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Mémoire d'un calcul — et d'un seul.
 *
 * ## Le problème
 *
 * La synthèse de conformité relit la situation de chaque parcelle pour chaque
 * apport, chaque couvert, chaque contrôle : sur une exploitation de 150
 * parcelles, près de sept mille requêtes, chacune rapide, mais dont les
 * allers-retours coûtaient huit secondes — bien davantage sur un Raspberry Pi.
 * L'essentiel relisait ce qui venait d'être lu : le contexte d'une parcelle,
 * sa région, ses cultures.
 *
 * ## Ce que fait cette mémoire
 *
 * `dansUnCalcul` ouvre une mémoire pour la durée d'un calcul ; `memoise` y
 * garde le résultat d'une lecture, sous une clé qui dit tout ce dont elle
 * dépend. La mémoire disparaît avec le calcul : rien n'est gardé d'une
 * synthèse à la suivante, et une donnée corrigée est relue dès l'appel
 * suivant — c'est ce que l'exploitant attend d'une anomalie qu'il vient de
 * corriger.
 *
 * Hors d'un calcul ouvert, `memoise` ne garde rien : chaque appel lit la base,
 * exactement comme avant.
 *
 * ## Ce qu'on n'y met pas
 *
 * Ce qui dépend d'une date sans que la date soit dans la clé, et ce que
 * l'appelant modifierait : un résultat gardé est partagé entre tous ceux qui
 * le demandent.
 */
const memoire = new AsyncLocalStorage<Map<string, Promise<unknown>>>();

export function dansUnCalcul<T>(calcul: () => Promise<T>): Promise<T> {
  // Un calcul imbriqué (le dossier de contrôle appelle la synthèse) partage
  // la mémoire de celui qui l'englobe.
  if (memoire.getStore()) return calcul();
  return memoire.run(new Map(), calcul);
}

export function memoise<T>(cle: string, lecture: () => Promise<T>): Promise<T> {
  const gardes = memoire.getStore();
  if (!gardes) return lecture();

  const deja = gardes.get(cle) as Promise<T> | undefined;
  if (deja) return deja;

  const resultat = lecture();
  gardes.set(cle, resultat);
  // Un échec n'est pas gardé : l'appel suivant retente.
  resultat.catch(() => gardes.delete(cle));
  return resultat;
}
