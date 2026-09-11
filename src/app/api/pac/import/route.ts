import type { NextRequest } from 'next/server';
import { requireFarmAccess } from '@/lib/auth/rbac';
import { clientIp, ok, route } from '@/lib/api/handler';
import { badRequest } from '@/lib/api/errors';
import { logAudit } from '@/lib/audit';
import { readDossier, DossierError, type DeposedFile } from '@/lib/pac/dossier';
import { analyzeDossier } from '@/lib/pac/analyze';
import { applyImport, type FeatureDecision } from '@/lib/pac/apply';
import { getEnv } from '@/lib/env';

/**
 * Import d'un dossier TéléPAC.
 *
 * Deux temps, jamais un seul : `POST` analyse et rend un aperçu sans rien
 * écrire ; `PUT` applique les décisions prises sur cet aperçu. Un import qui
 * s'appliquerait dès le dépôt ne laisserait aucune occasion de constater qu'on
 * s'est trompé de fichier.
 *
 * Aucun identifiant TéléPAC n'est demandé : Parcelys ne se connecte pas au
 * portail, il travaille sur les fichiers que l'utilisateur a téléchargés.
 */

/** Les dossiers PAC sont volumineux ; l'analyse d'un gros dossier prend du temps. */
export const maxDuration = 300;

function limiteOctets(): number {
  // On réutilise la limite des documents joints : c'est le même disque, et le
  // même utilisateur qui téléverse.
  return getEnv().UPLOAD_MAX_BYTES;
}

async function lireFichiers(request: NextRequest): Promise<{
  files: DeposedFile[];
  year: number;
  form: FormData;
}> {
  const form = await request.formData().catch(() => null);
  if (!form) throw badRequest('Aucun fichier reçu.');

  const year = Number(form.get('year'));
  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    throw badRequest('Campagne invalide.');
  }

  const files: DeposedFile[] = [];
  let total = 0;

  for (const entree of form.getAll('files')) {
    if (typeof entree === 'string') continue;
    const buffer = Buffer.from(await entree.arrayBuffer());
    total += buffer.byteLength;
    if (total > limiteOctets()) {
      throw badRequest(
        `Dépôt trop volumineux (limite : ${Math.round(limiteOctets() / 1024 / 1024)} Mo). ` +
          "Déposez l'archive ZIP plutôt que les fichiers décompressés.",
      );
    }
    files.push({ name: entree.name, buffer });
  }

  if (files.length === 0) throw badRequest('Aucun fichier reçu.');
  return { files, year, form };
}

/** POST — analyse un dépôt et rend l'aperçu. N'écrit rien. */
export const POST = route(async (request: NextRequest) => {
  const ctx = await requireFarmAccess('parcel:write');
  const { files, year, form } = await lireFichiers(request);

  // Les choix de correspondance et de système de coordonnées, quand
  // l'utilisateur revient sur l'aperçu après avoir corrigé.
  const choices = safeJson(form.get('choices'));
  const sridOverride = safeJson(form.get('sridOverride'));

  try {
    const dossier = await readDossier(files, year);
    const analyse = await analyzeDossier({
      farmId: ctx.farmId,
      year,
      layers: dossier.layers,
      ignoredFiles: dossier.ignored,
      problems: dossier.problems,
      choices: choices as never,
      sridOverride: sridOverride as never,
      provenance: dossier.provenance,
    });

    return ok({
      ...analyse,
      // Les géométries sont renvoyées pour l'aperçu cartographique ; les
      // attributs bruts ne le sont pas, ils alourdiraient la réponse sans
      // servir à l'affichage.
      features: analyse.features.map(({ attributes, sourceWkt, ...reste }) => ({
        ...reste,
        attributeCount: Object.keys(attributes).length,
        hasSource: sourceWkt !== null,
      })),
    });
  } catch (cause) {
    if (cause instanceof DossierError) throw badRequest(cause.message);
    throw cause;
  }
});

/** PUT — applique un import après validation de l'aperçu. */
export const PUT = route(async (request: NextRequest) => {
  const ctx = await requireFarmAccess('parcel:write');
  const { files, year, form } = await lireFichiers(request);

  const choices = safeJson(form.get('choices'));
  const sridOverride = safeJson(form.get('sridOverride'));
  const decisions = (safeJson(form.get('decisions')) ?? []) as FeatureDecision[];

  try {
    // On rejoue l'analyse plutôt que de faire confiance à un aperçu renvoyé par
    // le navigateur : les géométries qui entrent en base doivent venir des
    // fichiers, pas d'un aller-retour par le client.
    const dossier = await readDossier(files, year);
    const analyse = await analyzeDossier({
      farmId: ctx.farmId,
      year,
      layers: dossier.layers,
      ignoredFiles: dossier.ignored,
      problems: dossier.problems,
      choices: choices as never,
      sridOverride: sridOverride as never,
      provenance: dossier.provenance,
    });

    if (analyse.layers.some((l) => l.srid === null)) {
      throw badRequest(
        "Le système de coordonnées d'au moins une couche est inconnu. " +
          "Indiquez-le avant d'importer : une conversion au jugé déplacerait le parcellaire.",
      );
    }

    const resultat = await applyImport({
      farmId: ctx.farmId,
      year,
      userId: ctx.user.id,
      features: analyse.features,
      decisions,
      sourceFiles: files.map((f) => f.name),
      detectedSrid: analyse.layers[0]?.srid ?? null,
      sridLabel: analyse.layers[0]?.sridLabel ?? '',
      ilotLayers: analyse.layers.filter((l) => l.isIlotLayer).map((l) => l.name),
    });

    await logAudit({
      action: 'pac.imported',
      userId: ctx.user.id,
      farmId: ctx.farmId,
      entity: 'PacImport',
      entityId: resultat.importId,
      ipAddress: clientIp(request),
      metadata: {
        year,
        created: resultat.created,
        updated: resultat.updated,
        files: files.map((f) => f.name),
      },
    });

    return ok(
      {
        ...resultat,
        message:
          `${resultat.created} parcelle(s) créée(s), ${resultat.updated} mise(s) à jour, ` +
          `${resultat.crops} culture(s) rattachée(s). ` +
          "Une sauvegarde a été prise avant l'import." +
          // TéléPAC réattribue les numéros libérés d'une campagne à l'autre.
          // Quand deux parcelles distinctes revendiquent le même, Parcelys ne
          // les fond pas et suffixe le numéro interne de la seconde — mieux
          // vaut le dire que le laisser découvrir dans une colonne.
          (resultat.renumerotees.length > 0
            ? ` ${resultat.renumerotees.length} numéro(s) de parcelle étaient déjà ` +
              `employés par d’autres parcelles (${resultat.renumerotees
                .slice(0, 3)
                .map((r) => `${r.declare} → ${r.attribue}`)
                .join(', ')}` +
              `${resultat.renumerotees.length > 3 ? '…' : ''}) : ` +
              'le numéro interne a été complété pour rester unique. Vous pouvez ' +
              'renommer ces parcelles depuis leur fiche.'
            : ''),
      },
      201,
    );
  } catch (cause) {
    if (cause instanceof DossierError) throw badRequest(cause.message);
    throw cause;
  }
});

function safeJson(value: FormDataEntryValue | null): unknown {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}
