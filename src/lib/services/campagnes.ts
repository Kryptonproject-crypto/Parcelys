import 'server-only';
import { prisma } from '@/lib/prisma';
import { campagneCourante } from '@/lib/shared/campagne';

/**
 * Ce que chaque campagne contient, pour une exploitation.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * POURQUOI CE SERVICE EXISTE
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Les sélecteurs de campagne offraient huit années nues : 2028, 2027, 2026…
 * Rien ne disait où étaient les données. Choisir la bonne revenait à essayer
 * les années une par une jusqu'à ce qu'une liste cesse d'être vide.
 *
 * Le cas qui l'a rendu criant : le 11 septembre 2026, la campagne en cours est
 * 2027 — on sème pour la récolte 2027. Un dossier TéléPAC 2026 fraîchement
 * importé pose donc ses cultures en 2026, et la liste des parcelles, qui
 * affiche 2027, montre 141 parcelles « sans culture déclarée ». Les cultures
 * sont bien là ; c'est l'écran qui regarde ailleurs, sans le dire.
 *
 * Ce service donne de quoi le dire : quelles campagnes portent des cultures,
 * lesquelles portent un dossier PAC, et laquelle a été importée en dernier.
 *
 * Il ne décide rien à la place de l'utilisateur : il ne bascule pas
 * automatiquement sur une autre campagne, il fournit de quoi l'avertir et lui
 * offrir le lien. Basculer tout seul ferait saisir un traitement dans une
 * campagne qu'il n'a pas choisie.
 */

export type CampagneResume = {
  year: number;
  /** Parcelles distinctes portant une culture déclarée sur cette campagne. */
  parcellesAvecCulture: number;
  /** Îlots PAC importés pour cette campagne. */
  ilots: number;
  /** Entités PAC (parcelles, SNA, ZDH) pour cette campagne. */
  entites: number;
  dernierImport: Date | null;
};

/**
 * Les campagnes à proposer, la plus récente d'abord.
 *
 * Toute campagne qui porte quelque chose y figure, si ancienne soit-elle — on
 * n'ampute pas l'historique d'un exploitant parce qu'il dépasse une fenêtre
 * arbitraire. S'y ajoutent la campagne en cours, la suivante (on prépare un
 * assolement avant de le semer) et les précédentes, même vides : c'est là qu'on
 * saisit une campagne qui commence.
 */
export async function resumeCampagnes(
  farmId: string,
  { profondeur = 5, date = new Date() }: { profondeur?: number; date?: Date } = {},
): Promise<CampagneResume[]> {
  const courante = campagneCourante(date);

  const [cultures, campagnes] = await Promise.all([
    prisma.$queryRaw<Array<{ year: number; n: bigint }>>`
      SELECT cy.campaign_year AS year, count(DISTINCT cy.parcel_id)::bigint AS n
      FROM crop_years cy
      JOIN parcels p ON p.id = cy.parcel_id
      WHERE p.farm_id = ${farmId} AND p.deleted_at IS NULL
      GROUP BY cy.campaign_year
    `,
    prisma.pacCampaign.findMany({
      where: { farmId },
      select: {
        year: true,
        lastImportAt: true,
        _count: { select: { ilots: true, features: true } },
      },
    }),
  ]);

  const parYear = new Map<number, CampagneResume>();
  const assurer = (year: number): CampagneResume => {
    let resume = parYear.get(year);
    if (!resume) {
      resume = { year, parcellesAvecCulture: 0, ilots: 0, entites: 0, dernierImport: null };
      parYear.set(year, resume);
    }
    return resume;
  };

  for (const ligne of cultures) assurer(ligne.year).parcellesAvecCulture = Number(ligne.n);
  for (const campagne of campagnes) {
    const resume = assurer(campagne.year);
    resume.ilots = campagne._count.ilots;
    resume.entites = campagne._count.features;
    resume.dernierImport = campagne.lastImportAt;
  }
  for (let n = -1; n < profondeur; n += 1) assurer(courante - n);

  return [...parYear.values()].sort((a, b) => b.year - a.year);
}

/** Une campagne porte-t-elle quoi que ce soit ? */
export function campagneGarnie(resume: CampagneResume): boolean {
  return resume.parcellesAvecCulture > 0 || resume.ilots > 0 || resume.entites > 0;
}

/**
 * La campagne à ouvrir par défaut sur la page PAC.
 *
 * Celle du dernier import, à défaut la plus récente qui porte un dossier, à
 * défaut la campagne en cours. La page PAC n'est pas un écran de saisie : on y
 * vient pour retrouver le dossier qu'on a déposé, pas pour en commencer un que
 * la télédéclaration n'a pas encore ouvert.
 *
 * La page affiche laquelle, et pourquoi — un défaut qui ne s'explique pas est
 * un défaut qu'on croit être un bug.
 */
export function campagnePacParDefaut(
  resumes: CampagneResume[],
  date = new Date(),
): { year: number; raison: 'dernier-import' | 'dossier' | 'courante' } {
  const importees = resumes
    .filter((r) => r.dernierImport !== null)
    .sort((a, b) => (b.dernierImport?.getTime() ?? 0) - (a.dernierImport?.getTime() ?? 0));
  const derniere = importees[0];
  if (derniere) return { year: derniere.year, raison: 'dernier-import' };

  const garnie = resumes.find((r) => r.ilots > 0 || r.entites > 0);
  if (garnie) return { year: garnie.year, raison: 'dossier' };

  return { year: campagneCourante(date), raison: 'courante' };
}

/**
 * La campagne affichée est vide, une autre ne l'est pas : laquelle proposer ?
 *
 * Rend `null` dès que la campagne affichée porte quelque chose — il n'y a alors
 * rien à signaler, et un bandeau permanent finit par ne plus être lu.
 */
export function campagneARecommander(
  resumes: CampagneResume[],
  affichee: number,
): CampagneResume | null {
  const courante = resumes.find((r) => r.year === affichee);
  if (courante && campagneGarnie(courante)) return null;

  return (
    resumes
      .filter((r) => r.year !== affichee && r.parcellesAvecCulture > 0)
      .sort((a, b) => b.year - a.year)[0] ?? null
  );
}
