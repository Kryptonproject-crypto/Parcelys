import type { CatalogUsage, OfflineCatalogueEntry, Referential } from './types';

/**
 * Le catalogue embarqué : chercher et consulter un produit sans réseau.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * CE QU'IL EST, ET CE QU'IL N'EST PAS
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Ce n'est **pas** le catalogue E-Phy. Le catalogue officiel compte plus de
 * quinze mille produits ; celui-ci en compte quelques dizaines — ceux que
 * l'exploitation a réellement employés dans l'année, avec leurs usages
 * officiels tels que le serveur les a envoyés.
 *
 * La distinction n'est pas un détail de vocabulaire. Un exploitant qui cherche
 * un produit qu'il n'a jamais utilisé ne le trouvera pas hors ligne, et
 * l'application doit le lui dire dans ces termes-là : « pas dans les produits
 * que vous avez déjà employés », et non « produit inconnu » — qui laisserait
 * croire que le produit n'existe pas, ou pire, qu'il n'est pas autorisé.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * POURQUOI IL EXISTE
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Sans lui, hors réseau, l'application acceptait la saisie d'un traitement sans
 * aucun contrôle : ni dose maximale, ni culture autorisée, ni ZNT, ni délai
 * avant récolte. Au champ, pulvérisateur en route, c'est-à-dire exactement là
 * où le contrôle sert.
 */

/** Ce que la recherche rend, dans la forme attendue par l'écran de saisie. */
export type ProduitLocal = {
  id: string;
  amm: string;
  name: string;
  holder: string | null;
  status: string | null;
  authorized: boolean;
  withdrawnAt: string | null;
  formulation: string | null;
  productType: string | null;
  substances: string[];
};

/** Fiche complète, même forme que la réponse en ligne. */
export type FicheLocale = {
  product: {
    id: string;
    amm: string;
    name: string;
    status: string | null;
    authorized: boolean;
    withdrawnAt: string | null;
  };
  usages: CatalogUsage[];
  crops: string[];
  drainedSoilRestrictions: OfflineCatalogueEntry['drainedSoilRestrictions'];
  /**
   * Provenance, dans la même forme que la réponse en ligne.
   *
   * `lastSyncAt` est la date de la dernière synchronisation E-Phy du serveur,
   * pas celle de l'instantané : c'est l'édition du catalogue qui date la
   * donnée, pas le moment où le téléphone l'a reçue.
   */
  source: {
    label: string;
    lastSyncAt: string | null;
    productsInBase: number;
    authorizedInBase: number;
    configured: boolean;
  };
};

/** Comparaison insensible à la casse, aux accents et à la ponctuation. */
function normaliser(valeur: string): string {
  return valeur
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

function versProduit(entree: OfflineCatalogueEntry): ProduitLocal {
  return {
    id: entree.productId,
    amm: entree.amm,
    name: entree.name,
    holder: entree.holder,
    status: entree.status,
    authorized: entree.authorized,
    withdrawnAt: entree.withdrawnAt,
    formulation: entree.formulation,
    productType: entree.productType,
    substances: entree.substances,
  };
}

/**
 * Cherche dans le catalogue embarqué, par nom, AMM ou substance.
 *
 * Les produits retirés sont écartés par défaut, comme en ligne : le catalogue
 * officiel est un historique, et proposer un produit retiré au moment de saisir
 * un traitement serait proposer une infraction. Ils restent accessibles en le
 * demandant explicitement, parce qu'un traitement passé se saisit parfois après
 * coup, et qu'il faut alors pouvoir nommer le produit employé.
 */
export function chercherHorsLigne(
  referential: Referential | null | undefined,
  terme: string,
  inclureRetires = false,
): ProduitLocal[] {
  const catalogue = referential?.phytoCatalogue ?? [];
  const cherche = normaliser(terme);
  if (cherche.length < 2) return [];

  // L'AMM se cherche telle quelle : c'est une suite de chiffres, la normaliser
  // ne changerait rien, mais la comparer par préfixe évite d'exiger les huit.
  const chiffres = terme.replace(/\D/g, '');

  return catalogue
    .filter((entree) => {
      if (!inclureRetires && !entree.authorized) return false;
      if (chiffres.length >= 4 && entree.amm.startsWith(chiffres)) return true;
      if (normaliser(entree.name).includes(cherche)) return true;
      return entree.substances.some((s: string) => normaliser(s).includes(cherche));
    })
    .map(versProduit)
    .slice(0, 15);
}

/** Combien de produits retirés la recherche a-t-elle masqués ? */
export function retiresMasques(
  referential: Referential | null | undefined,
  terme: string,
): number {
  return (
    chercherHorsLigne(referential, terme, true).length -
    chercherHorsLigne(referential, terme, false).length
  );
}

/**
 * Fiche d'un produit embarqué, par AMM ou par identifiant.
 *
 * Rend `null` quand le produit n'est pas embarqué — et c'est une réponse, pas
 * un échec : l'appelant doit alors dire qu'il ne sait pas, jamais supposer que
 * la dose est bonne.
 */
export function ficheHorsLigne(
  referential: Referential | null | undefined,
  ammOuId: string,
): FicheLocale | null {
  const entree = (referential?.phytoCatalogue ?? []).find(
    (e) => e.amm === ammOuId || e.productId === ammOuId,
  );
  if (!entree) return null;

  return {
    product: {
      id: entree.productId,
      amm: entree.amm,
      name: entree.name,
      status: entree.status,
      authorized: entree.authorized,
      withdrawnAt: entree.withdrawnAt,
    },
    usages: entree.usages,
    crops: entree.crops,
    drainedSoilRestrictions: entree.drainedSoilRestrictions,
    source: {
      label: referential?.phytoCatalogueSource?.label ?? 'Catalogue E-Phy (embarqué)',
      lastSyncAt: referential?.phytoCatalogueSource?.lastSyncAt ?? null,
      // Le nombre de produits embarqués, et non celui du catalogue entier : la
      // fiche ne doit pas laisser croire qu'on dispose des quinze mille.
      productsInBase: (referential?.phytoCatalogue ?? []).length,
      authorizedInBase: (referential?.phytoCatalogue ?? []).filter((e) => e.authorized)
        .length,
      configured: referential?.phytoCatalogueSource?.configured ?? false,
    },
  };
}

/**
 * De quoi dire à l'utilisateur ce que vaut ce qu'il a sous les yeux.
 *
 * Un contrôle de dose fondé sur une édition du catalogue vieille de six mois
 * n'est pas faux, mais il n'est pas non plus la même chose qu'un contrôle fait
 * en ligne. L'écran doit pouvoir le dire.
 */
export function provenanceHorsLigne(referential: Referential | null | undefined): {
  disponible: boolean;
  produits: number;
  omis: number;
  synchroniseLe: string | null;
} {
  const catalogue = referential?.phytoCatalogue ?? [];
  const source = referential?.phytoCatalogueSource;
  return {
    disponible: catalogue.length > 0,
    produits: catalogue.length,
    omis: source?.omitted ?? 0,
    synchroniseLe: source?.lastSyncAt ?? null,
  };
}
