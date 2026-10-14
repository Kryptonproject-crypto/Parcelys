import 'server-only';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import {
  beginImport,
  enregistrerIntegration,
  failImport,
  finishImport,
  type FichierVerifie,
} from '@/lib/regulatory/referentials';
import {
  referenceDe,
  type Transcription,
  type TranscriptionZar,
} from '@/lib/regulatory/transcription';

export type { FichierVerifie } from '@/lib/regulatory/referentials';

/**
 * Import des règles transcrites, et des zones d'actions renforcées.
 *
 * Le script lit les fichiers et vérifie leurs empreintes ; ce module écrit en
 * base. La séparation permet de tester l'écriture — qui porte les règles
 * d'historique et de traçabilité — sans les PDF.
 */

// ---------------------------------------------------------------------------
// Règles
// ---------------------------------------------------------------------------

/**
 * Importe les règles d'une transcription comme une version de référentiel.
 *
 * Réimporter la même version remplace ses règles — jamais celles d'une autre
 * version : la campagne 2024-2025 doit pouvoir relire les règles qui l'ont
 * régie, même après l'import d'un programme suivant.
 */
export async function importerTranscription(
  transcription: Transcription,
  fichiers: FichierVerifie[],
): Promise<{ referentialId: string; regles: number }> {
  const ref = transcription.referentiel;
  const { referentiel, journal } = await beginImport({
    code: ref.code,
    domain: ref.domaine,
    name: ref.nom,
    territory: ref.territoire,
    version: ref.version,
    sourceLabel: ref.source,
    appliesFrom: new Date(`${ref.applicableDu}T00:00:00Z`),
    appliesTo: ref.applicableAu ? new Date(`${ref.applicableAu}T23:59:59Z`) : null,
  });

  try {
    await prisma.$transaction([
      prisma.regulatoryRule.deleteMany({ where: { referentialId: referentiel.id } }),
      prisma.regulatoryRule.createMany({
        data: transcription.regles.map((regle) => ({
          referentialId: referentiel.id,
          domain: regle.domaine,
          code: regle.code,
          label: regle.libelle,
          territory: ref.territoire,
          condition: (regle.condition ?? Prisma.JsonNull) as Prisma.InputJsonValue,
          value: regle.valeur as Prisma.InputJsonValue,
          unit: regle.unite,
          exception: regle.exception,
          appliesFrom: new Date(`${regle.depuis}T00:00:00Z`),
          appliesTo: regle.jusquau ? new Date(`${regle.jusquau}T23:59:59Z`) : null,
          sourceRef: referenceDe(transcription, regle),
          citation: regle.source.citation,
        })),
      }),
    ]);

    // Les périodes d'application et les textes de la version, mis à jour à
    // chaque import : une version corrigée de la transcription ne doit pas
    // laisser l'ancienne date d'entrée en vigueur en place.
    await prisma.regulatoryReferential.update({
      where: { id: referentiel.id },
      data: {
        name: ref.nom,
        sourceLabel: ref.source,
        appliesFrom: new Date(`${ref.applicableDu}T00:00:00Z`),
        appliesTo: ref.applicableAu ? new Date(`${ref.applicableAu}T23:59:59Z`) : null,
        checksum: fichiers.map((f) => f.sha256.slice(0, 12)).join('+') || null,
      },
    });

    await finishImport({
      referentialId: referentiel.id,
      importId: journal.id,
      recordCount: transcription.regles.length,
      warnings: ref.notes,
      remplaceLesVersionsAnterieures: ref.remplaceLesVersionsAnterieures,
    });
    await enregistrerIntegration(referentiel.id, {
      etat: transcription.manques.length > 0 ? 'partiel' : 'complet',
      millesime: ref.applicableDu.slice(0, 4),
      fichiers,
      elements: [{ quoi: 'règles transcrites', nombre: transcription.regles.length }],
      manques: transcription.manques,
    });
  } catch (erreur) {
    await failImport({
      referentialId: referentiel.id,
      importId: journal.id,
      message: erreur instanceof Error ? erreur.message : String(erreur),
    });
    throw erreur;
  }

  return { referentialId: referentiel.id, regles: transcription.regles.length };
}

// ---------------------------------------------------------------------------
// Zones d'actions renforcées
// ---------------------------------------------------------------------------

/** Version active d'un référentiel de zonage, ou erreur explicite. */
async function referentielActif(code: string, raison: string): Promise<{ id: string; version: string }> {
  const r = await prisma.regulatoryReferential.findFirst({
    where: { code, status: 'ACTIF' },
    orderBy: { importedAt: 'desc' },
    select: { id: true, version: true },
  });
  if (!r) {
    throw new Error(`Le référentiel « ${code} » doit être importé avant les ZAR : ${raison}`);
  }
  return r;
}

export type BilanZar = {
  referentialId: string;
  zones: number;
  avecPerimetre: string[];
  indetermines: string[];
  avertissements: string[];
};

/**
 * Importe les zones d'actions renforcées.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * DEUX CAS, ET JAMAIS UN TROISIÈME
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * **Le captage a une aire d'alimentation au référentiel national.** Elle est
 * retenue comme périmètre, comme le prévoit le code de l'environnement selon la
 * fiche DRAAF/DREAL — mais seulement si elle recoupe une commune citée par
 * l'arrêté. Le rapprochement par le nom est fait à la transcription ; il est
 * **vérifié sur le terrain** ici, et une AAC qui ne toucherait aucune commune
 * citée est refusée. Seule la partie en Auvergne-Rhône-Alpes est retenue : le
 * PAR régional ne s'applique pas au-delà (art. 1er et art. 3, III).
 *
 * **Le captage n'en a pas.** Le périmètre est inconnu. La commune citée est
 * enregistrée avec un classement « incertain » : une parcelle qui la recoupe
 * voit son appartenance à la ZAR **indéterminée**, jamais affirmée.
 *
 * Il n'y a pas de cas où l'on « suppose » un périmètre.
 */
export async function importerZar(
  transcription: TranscriptionZar,
  fichiers: FichierVerifie[],
): Promise<BilanZar> {
  const ref = transcription.referentiel;

  // Ce dont les périmètres dépendent. Leur absence est une erreur, pas un cas
  // dégradé : un import de ZAR sans zones vulnérables ni AAC ne produirait que
  // des indéterminations, sans le dire.
  const zv = await referentielActif('zones-vulnerables', 'le contour des communes citées en vient.');
  const aac = await referentielActif('aires-alimentation-captage', 'les périmètres reconstitués en viennent.');
  const limites = await referentielActif(
    'limites-administratives',
    'seule la partie des périmètres située dans la région est une ZAR du PAR régional.',
  );

  const { referentiel, journal } = await beginImport({
    code: ref.code,
    domain: ref.domaine,
    name: ref.nom,
    territory: ref.territoire,
    version: ref.version,
    sourceLabel: ref.source,
    appliesFrom: new Date(`${ref.applicableDu}T00:00:00Z`),
    appliesTo: ref.applicableAu ? new Date(`${ref.applicableAu}T23:59:59Z`) : null,
  });

  const bilan: BilanZar = {
    referentialId: referentiel.id,
    zones: 0,
    avecPerimetre: [],
    indetermines: [],
    avertissements: [],
  };

  try {
    await prisma.regulatoryZone.deleteMany({ where: { referentialId: referentiel.id } });

    for (const captage of transcription.captages) {
      const document = transcription.documents[captage.source.document];
      const texte = `${document?.titre.split(' relatif')[0]?.split(' modifiant')[0] ?? captage.source.document}, ${captage.source.article}`;
      const insees = captage.communes.map((c) => c.insee);
      const communs = {
        captage: captage.nom,
        captageId: captage.id,
        regionDuCaptage: captage.regionDuCaptage,
        communes: captage.communes.map((c) => `${c.nom} (${c.insee})`),
        texte,
        citation: captage.source.citation,
        pointsSandre: captage.pointsSandre,
        cartographieOfficielle: 'Cartographie DREAL Auvergne-Rhône-Alpes (non fournie) : elle fait foi en cas d’écart.',
      };

      let retenues: string[] = [];
      if (captage.perimetre.type === 'aire-alimentation-captage') {
        const cdAac = captage.perimetre.cdAac;
        const controle = await prisma.$queryRaw<Array<{ code: string; recoupe: boolean | null }>>`
          SELECT a.code, bool_or(ST_Intersects(a.geom, c.geom)) AS recoupe
          FROM regulatory_zones a
          LEFT JOIN regulatory_zones c
            ON c.referential_id = ${zv.id}
           AND c.kind = 'ZONE_VULNERABLE'
           AND c.code IN (${Prisma.join(insees)})
          WHERE a.referential_id = ${aac.id}
            AND a.kind = 'AIRE_ALIMENTATION_CAPTAGE'
            AND a.code IN (${Prisma.join(cdAac)})
          GROUP BY a.code
        `;
        for (const code of cdAac) {
          const ligne = controle.find((l) => l.code === code);
          if (!ligne) {
            bilan.avertissements.push(
              `${captage.nom} : AAC ${code} absente du référentiel des AAC v${aac.version}.`,
            );
          } else if (!ligne.recoupe) {
            bilan.avertissements.push(
              `${captage.nom} : AAC ${code} ne recoupe aucune commune citée par l’arrêté — rapprochement refusé.`,
            );
          } else {
            retenues.push(code);
          }
        }
      }

      if (retenues.length > 0 && captage.perimetre.type === 'aire-alimentation-captage') {
        const attributs = {
          ...communs,
          perimetre: 'aire-alimentation-captage',
          reconstitue: true,
          cdAac: retenues,
          rapprochement: captage.perimetre.rapprochement,
          classements: [
            {
              depuis: captage.depuis,
              valeur: 'périmètre reconstitué : aire d’alimentation du captage',
              source: texte,
            },
          ],
        };
        const versees = await prisma.$executeRaw`
          INSERT INTO regulatory_zones (id, referential_id, kind, code, label, geom, attributes, created_at)
          SELECT
            'z' || replace(gen_random_uuid()::text, '-', ''),
            ${referentiel.id},
            'ZONE_ACTION_RENFORCEE'::"ZoneKind",
            ${captage.id},
            ${`ZAR — ${captage.nom}`},
            ST_Multi(ST_CollectionExtract(ST_MakeValid(ST_Intersection(ST_Union(a.geom), r.geom)), 3)),
            ${JSON.stringify(attributs)}::jsonb,
            now()
          FROM regulatory_zones a
          CROSS JOIN LATERAL (
            SELECT z.geom FROM regulatory_zones z
            WHERE z.referential_id = ${limites.id}
              AND z.kind = 'REGION_ADMINISTRATIVE'
              AND z.code = ${ref.territoire}
            LIMIT 1
          ) r
          WHERE a.referential_id = ${aac.id}
            AND a.kind = 'AIRE_ALIMENTATION_CAPTAGE'
            AND a.code IN (${Prisma.join(retenues)})
          GROUP BY r.geom
          HAVING NOT ST_IsEmpty(ST_Intersection(ST_Union(a.geom), r.geom))
        `;
        if (versees === 0) {
          bilan.avertissements.push(
            `${captage.nom} : l’aire d’alimentation ne recoupe pas la région ${ref.territoire}.`,
          );
          retenues = [];
        } else {
          bilan.zones += versees;
          bilan.avecPerimetre.push(captage.nom);
          continue;
        }
      }

      // Périmètre inconnu : la commune citée, avec un classement incertain.
      const raison =
        captage.perimetre.type === 'non-fourni'
          ? captage.perimetre.raison
          : 'Le rapprochement à une aire d’alimentation n’a pas pu être vérifié.';
      for (const commune of captage.communes) {
        const attributs = {
          ...communs,
          perimetre: 'commune-citee',
          reconstitue: false,
          commune: `${commune.nom} (${commune.insee})`,
          raisonIncertitude:
            `Le périmètre de la ZAR « ${captage.nom} » n’est pas fourni (${raison}) ` +
            `L’arrêté cite la commune de ${commune.nom} : une parcelle qui la recoupe ` +
            'peut être en ZAR, ou non. La cartographie de la DREAL tranche.',
          classements: [
            {
              depuis: captage.depuis,
              valeur: 'incertaine : périmètre non fourni, commune citée par l’arrêté',
              source: texte,
            },
          ],
        };
        const versees = await prisma.$executeRaw`
          INSERT INTO regulatory_zones (id, referential_id, kind, code, label, geom, attributes, created_at)
          SELECT
            'z' || replace(gen_random_uuid()::text, '-', ''),
            ${referentiel.id},
            'ZONE_ACTION_RENFORCEE'::"ZoneKind",
            ${captage.id},
            ${`ZAR possible — ${captage.nom} (${commune.nom})`},
            c.geom,
            ${JSON.stringify(attributs)}::jsonb,
            now()
          FROM regulatory_zones c
          WHERE c.referential_id = ${zv.id}
            AND c.kind = 'ZONE_VULNERABLE'
            AND c.code = ${commune.insee}
          LIMIT 1
        `;
        if (versees === 0) {
          bilan.avertissements.push(
            `${captage.nom} : la commune ${commune.nom} (${commune.insee}) n’a pas de contour dans le zonage des zones vulnérables — rien n’est enregistré pour elle.`,
          );
        }
        bilan.zones += versees;
      }
      bilan.indetermines.push(captage.nom);
    }

    await finishImport({
      referentialId: referentiel.id,
      importId: journal.id,
      recordCount: bilan.zones,
      warnings: [...ref.notes, ...bilan.avertissements],
      remplaceLesVersionsAnterieures: ref.remplaceLesVersionsAnterieures,
    });
    await enregistrerIntegration(referentiel.id, {
      etat: bilan.indetermines.length > 0 ? 'partiel' : 'complet',
      millesime: ref.applicableDu.slice(0, 4),
      fichiers,
      elements: [
        { quoi: 'captages classés en ZAR (annexe 1 modifiée)', nombre: transcription.captages.length },
        { quoi: 'captages au périmètre reconstitué par leur AAC', nombre: bilan.avecPerimetre.length },
        { quoi: 'captages au périmètre inconnu (commune citée, appartenance indéterminée)', nombre: bilan.indetermines.length },
      ],
      manques: [
        ...transcription.manques,
        ...bilan.indetermines.map((nom) => ({
          quoi: `Périmètre de la ZAR « ${nom} »`,
          pourquoi: 'Ni aire d’alimentation au référentiel national, ni périmètre de protection fourni.',
          consequence: 'Appartenance indéterminée sur la ou les communes citées par l’arrêté.',
        })),
      ],
    });
  } catch (erreur) {
    await failImport({
      referentialId: referentiel.id,
      importId: journal.id,
      message: erreur instanceof Error ? erreur.message : String(erreur),
    });
    throw erreur;
  }

  return bilan;
}
