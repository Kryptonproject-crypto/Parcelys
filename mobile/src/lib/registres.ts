import { FORMAT_REGISTRES, type FicheParcelle, type RegistresMobile } from '@commun/registres';
import { fetchRegistres } from './api';
import { readCached, writeCached } from './db';
import type { Session } from './types';

/**
 * Registres des parcelles, gardés sur le téléphone.
 *
 * Reçus à chaque synchronisation (ou presque : le serveur ne renvoie rien si
 * l'empreinte n'a pas bougé), enregistrés dans la base locale, et relus de là
 * par la fiche parcelle — réseau ou pas. C'est au champ qu'on se demande ce qui
 * a déjà été passé sur une parcelle, et c'est là que le réseau manque.
 *
 * Une seule exploitation à la fois, comme l'instantané : l'expert qui change
 * de domaine remplace ceux du précédent.
 */

const CLE = 'registres';

export type RegistresLocaux = {
  format: number;
  farmId: string;
  version: string;
  campaignYear: number;
  /** Préparés par le serveur. */
  generatedAt: string;
  /** Dernière fois que le serveur a confirmé qu'ils étaient à jour. */
  verifiedAt: string;
  parcels: Record<string, FicheParcelle>;
};

/** Ceux de `farmId`, s'ils sont sur l'appareil et dans le format attendu. */
export async function lireRegistres(farmId: string | null | undefined): Promise<RegistresLocaux | null> {
  if (!farmId) return null;
  const locaux = await readCached<RegistresLocaux>(CLE);
  if (!locaux || locaux.farmId !== farmId || locaux.format !== FORMAT_REGISTRES) return null;
  return locaux;
}

/**
 * Demande au serveur les registres de `farmId`, en lui donnant l'empreinte de
 * ceux déjà en cache. Rend ceux qui font foi désormais.
 *
 * Lève `OfflineError` hors réseau, `ApiError` si le serveur refuse (un serveur
 * antérieur à la 0.11.1 répond 404) : l'appelant garde alors ce qu'il avait.
 */
export async function actualiserRegistres(
  session: Session,
  farmId: string,
): Promise<RegistresLocaux> {
  const actuels = await lireRegistres(farmId);
  const reponse = await fetchRegistres(session, farmId, actuels?.version);
  const maintenant = new Date().toISOString();

  if (reponse.unchanged) {
    if (actuels && actuels.version === reponse.version) {
      const confirmes = { ...actuels, verifiedAt: maintenant };
      await writeCached(CLE, confirmes);
      return confirmes;
    }
    // « Inchangé » sans rien en cache ne devrait pas arriver (on n'envoie
    // l'empreinte que si l'on a les registres) : on redemande tout.
    return actualiserSansCache(session, farmId);
  }

  return enregistrer(reponse);
}

async function actualiserSansCache(session: Session, farmId: string): Promise<RegistresLocaux> {
  const reponse = await fetchRegistres(session, farmId, null);
  if (reponse.unchanged) throw new Error('Registres indisponibles.');
  return enregistrer(reponse);
}

async function enregistrer(
  reponse: Extract<RegistresMobile, { unchanged: false }>,
): Promise<RegistresLocaux> {
  const locaux: RegistresLocaux = {
    format: reponse.format,
    farmId: reponse.farmId,
    version: reponse.version,
    campaignYear: reponse.campaignYear,
    generatedAt: reponse.generatedAt,
    verifiedAt: new Date().toISOString(),
    parcels: reponse.parcels,
  };
  await writeCached(CLE, locaux);
  return locaux;
}
