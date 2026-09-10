import { describe, expect, it } from 'vitest';
import { syncStatusFrom } from '../mobile/src/lib/sync';

/**
 * Le voyant de synchronisation.
 *
 * Ce que ces tests protègent : **une saisie qui n'est pas partie n'existe que
 * dans ce téléphone**. Un voyant qui dit « synchronisé » alors qu'il reste des
 * traitements dans la file, c'est un registre réglementaire qu'on croit à jour
 * et qui ne l'est pas — on s'en aperçoit le jour du contrôle.
 *
 * Le second point protégé est l'inverse : **hors connexion n'est pas une
 * panne**. Une parcelle sans réseau est la situation normale au champ. Peindre
 * cela en rouge apprendrait surtout à l'exploitant à ne plus regarder le
 * voyant, et le rouge ne voudrait plus rien dire le jour où il compte.
 */

describe('Voyant de synchronisation', () => {
  const base = { online: true, pending: 0, syncing: false, error: null };

  it('vert seulement quand la file est vide, en ligne, sans erreur', () => {
    expect(syncStatusFrom(base)).toBe('synchronise');
  });

  it('ne dit jamais « synchronisé » quand il reste des saisies', () => {
    expect(syncStatusFrom({ ...base, pending: 1 })).toBe('en-attente');
    expect(syncStatusFrom({ ...base, pending: 12 })).toBe('en-attente');
  });

  it('l’envoi en cours passe avant tout le reste', () => {
    // C'est la seule information qui demande de patienter plutôt que d'agir.
    expect(syncStatusFrom({ ...base, syncing: true })).toBe('en-cours');
    expect(syncStatusFrom({ ...base, syncing: true, pending: 5 })).toBe('en-cours');
    expect(syncStatusFrom({ ...base, syncing: true, online: false })).toBe('en-cours');
    expect(syncStatusFrom({ ...base, syncing: true, error: 'échec' })).toBe('en-cours');
  });

  it('hors connexion n’est pas une erreur', () => {
    expect(syncStatusFrom({ ...base, online: false })).toBe('hors-ligne');
    expect(syncStatusFrom({ ...base, online: false, pending: 3 })).toBe('hors-ligne');
  });

  it('l’absence de réseau prime sur une erreur antérieure', () => {
    // Un échec constaté à l'entrée d'un bâtiment resterait rouge une fois hors
    // couverture, alors que la raison n'est plus la même.
    expect(syncStatusFrom({ ...base, online: false, error: 'délai dépassé' })).toBe(
      'hors-ligne',
    );
  });

  it('l’erreur prime sur l’attente : une saisie refusée ne partira pas seule', () => {
    expect(syncStatusFrom({ ...base, error: 'refusée', pending: 2 })).toBe('erreur');
    expect(syncStatusFrom({ ...base, error: 'refusée', pending: 0 })).toBe('erreur');
  });
});
