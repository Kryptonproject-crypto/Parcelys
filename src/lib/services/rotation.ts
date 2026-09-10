import 'server-only';
import { prisma } from '@/lib/prisma';

/**
 * Rotation des cultures.
 *
 * ## Aucun modèle nouveau, et c'est le point
 *
 * Une rotation n'est pas une donnée à saisir : c'est la **succession des
 * cultures déjà enregistrées**, lue parcelle par parcelle. Créer un modèle
 * « rotation » à remplir à la main aurait produit une seconde vérité, qui aurait
 * divergé de la première dès la première campagne où l'un des deux n'aurait pas
 * été mis à jour.
 *
 * Ce module ne fait donc que lire `CropYear` et présenter autrement.
 *
 * ## Ce qu'il ne fait pas
 *
 * Il ne dit pas si une rotation est « bonne ». Les règles de retour — délai
 * minimal entre deux cultures d'une même famille, part maximale d'une culture
 * dans l'assolement — relèvent selon les cas de la PAC, d'un cahier des charges
 * ou de l'agronomie régionale. Aucune n'est universelle, et aucune n'est codée
 * ici.
 *
 * Il signale une seule chose, factuelle et vérifiable sans référentiel : le
 * **retour de la même culture** sur une parcelle, avec le nombre d'années
 * écoulées. L'exploitant sait ce que cela vaut pour sa culture ; Parcelys, non.
 */

export type SuccessionParcelle = {
  parcelId: string;
  parcelName: string;
  areaHa: number;
  /** De la campagne la plus ancienne à la plus récente. */
  campagnes: Array<{
    campaignYear: number;
    cropName: string;
    variety: string | null;
    sowingDate: Date | null;
    harvestDate: Date | null;
    /** Couverts implantés dans l'interculture qui suit cette campagne. */
    couverts: Array<{ kind: string; species: string | null }>;
  }>;
  /** Retours de la même culture, avec l'écart en années. */
  retours: Array<{ cropName: string; annees: number[]; ecartMinimal: number }>;
  /** Campagnes sans culture enregistrée, entre la première et la dernière. */
  trous: number[];
};

export async function successionsExploitation(params: {
  farmId: string;
  /** Nombre de campagnes remontées. Cinq couvre une rotation courante. */
  profondeur?: number;
  jusqua?: number;
}): Promise<SuccessionParcelle[]> {
  const jusqua = params.jusqua ?? new Date().getFullYear();
  const profondeur = params.profondeur ?? 5;
  const depuis = jusqua - profondeur + 1;

  const parcelles = await prisma.parcel.findMany({
    where: { farmId: params.farmId, deletedAt: null },
    select: {
      id: true,
      name: true,
      areaHa: true,
      cropYears: {
        where: { campaignYear: { gte: depuis, lte: jusqua } },
        include: { crop: { select: { name: true } } },
        orderBy: { campaignYear: 'asc' },
      },
      soilCovers: {
        select: { kind: true, species: true, sownOn: true, cropYearId: true },
      },
    },
    orderBy: { name: 'asc' },
  });

  return parcelles.map((parcelle) => {
    const campagnes = parcelle.cropYears.map((cy) => ({
      campaignYear: cy.campaignYear,
      cropName: cy.crop.name,
      variety: cy.variety,
      sowingDate: cy.sowingDate,
      harvestDate: cy.actualHarvestDate ?? cy.expectedHarvestDate,
      couverts: parcelle.soilCovers
        .filter((c) => c.cropYearId === cy.id)
        .map((c) => ({ kind: c.kind as string, species: c.species })),
    }));

    // Retours de la même culture. On compte l'écart minimal, pas l'écart
    // moyen : c'est le retour le plus rapproché qui pose question, pas la
    // moyenne des retours.
    const parCulture = new Map<string, number[]>();
    for (const c of campagnes) {
      const annees = parCulture.get(c.cropName) ?? [];
      annees.push(c.campaignYear);
      parCulture.set(c.cropName, annees);
    }

    const retours = [...parCulture.entries()]
      .filter(([, annees]) => annees.length > 1)
      .map(([cropName, annees]) => {
        const triees = [...annees].sort((a, b) => a - b);
        let ecartMinimal = Number.POSITIVE_INFINITY;
        for (let i = 1; i < triees.length; i += 1) {
          ecartMinimal = Math.min(
            ecartMinimal,
            (triees[i] as number) - (triees[i - 1] as number),
          );
        }
        return { cropName, annees: triees, ecartMinimal };
      })
      .sort((a, b) => a.ecartMinimal - b.ecartMinimal);

    // Trous : années sans culture enregistrée entre la première et la dernière
    // connue. Une année manquante n'est pas une jachère — c'est une saisie
    // absente, et les confondre serait inventer une conduite.
    const annees = campagnes.map((c) => c.campaignYear);
    const trous: number[] = [];
    if (annees.length > 1) {
      const min = Math.min(...annees);
      const max = Math.max(...annees);
      for (let a = min; a <= max; a += 1) {
        if (!annees.includes(a)) trous.push(a);
      }
    }

    return {
      parcelId: parcelle.id,
      parcelName: parcelle.name,
      areaHa: Number(parcelle.areaHa),
      campagnes,
      retours,
      trous,
    };
  });
}

/*
 * Pas de fonction « assolement » ici.
 *
 * La page `/cultures` calcule déjà la répartition des surfaces d'une campagne,
 * à partir des mêmes `CropYear`. En écrire une seconde version aurait donné
 * deux chiffres pour la même chose, qui auraient fini par diverger — le genre
 * de doublon que la règle du projet interdit. La rotation, elle, n'existait
 * nulle part : c'est la seule chose que ce module ajoute.
 */
