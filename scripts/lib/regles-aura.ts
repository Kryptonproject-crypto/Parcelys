/**
 * Import des règles transcrites des textes d'Auvergne-Rhône-Alpes.
 *
 * Les transcriptions sont dans `data/referentiels-aura/transcriptions/`. Chacune
 * désigne ses documents sources par leur empreinte SHA-256 : avant d'importer
 * quoi que ce soit, on recalcule l'empreinte de chaque fichier cité. Un PDF
 * remplacé par une autre édition arrête l'import — les valeurs transcrites ont
 * été relues dans **cette** édition, pas dans la suivante.
 */

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import {
  analyserTranscription,
  analyserTranscriptionZar,
  type DocumentSource,
} from '@/lib/regulatory/transcription';
import { importerTranscription, importerZar, type FichierVerifie } from '@/lib/regulatory/import-regles';

function empreinte(chemin: string): string {
  return createHash('sha256').update(readFileSync(chemin)).digest('hex');
}

/** Vérifie que chaque document cité est présent et inchangé. */
export function verifierDocuments(
  dossier: string,
  documents: Record<string, DocumentSource>,
): FichierVerifie[] {
  const verifies: FichierVerifie[] = [];
  for (const [cle, document] of Object.entries(documents)) {
    const chemin = path.join(dossier, document.fichier);
    if (!existsSync(chemin)) {
      throw new Error(`Document « ${cle} » introuvable : ${document.fichier}.`);
    }
    const sha256 = empreinte(chemin);
    if (sha256 !== document.sha256) {
      throw new Error(
        `Le document « ${document.fichier} » a changé depuis sa transcription ` +
          `(empreinte ${sha256.slice(0, 12)}…, attendue ${document.sha256.slice(0, 12)}…). ` +
          'Relisez la nouvelle édition et mettez la transcription à jour avant de l’importer.',
      );
    }
    verifies.push({ chemin: document.fichier, sha256, octets: statSync(chemin).size });
  }
  return verifies;
}

function lireJson(chemin: string): unknown {
  return JSON.parse(readFileSync(chemin, 'utf8'));
}

/** Les transcriptions, dans l'ordre où elles doivent être importées. */
export const TRANSCRIPTIONS_AURA = {
  par: 'transcriptions/par7-aura.json',
  zar: 'transcriptions/zar-aura.json',
  gren: 'transcriptions/gren-aura.json',
} as const;

export async function importerReglesAura(dossier: string): Promise<void> {
  // Programme d'actions régional.
  {
    const t = analyserTranscription(lireJson(path.join(dossier, TRANSCRIPTIONS_AURA.par)));
    const fichiers = verifierDocuments(dossier, t.documents);
    const r = await importerTranscription(t, fichiers);
    console.info(`  ✓ ${t.referentiel.code} — ${t.referentiel.version} : ${r.regles} règles`);
    for (const manque of t.manques) console.info(`    · manque : ${manque.quoi}`);
  }

  // Zones d'actions renforcées.
  {
    const t = analyserTranscriptionZar(lireJson(path.join(dossier, TRANSCRIPTIONS_AURA.zar)));
    const fichiers = verifierDocuments(dossier, t.documents);
    const bilan = await importerZar(t, fichiers);
    console.info(
      `  ✓ ${t.referentiel.code} : ${t.captages.length} captages, ${bilan.zones} périmètre(s) ` +
        `(${bilan.avecPerimetre.length} reconstitué(s) par l’AAC, ${bilan.indetermines.length} indéterminé(s))`,
    );
    for (const a of bilan.avertissements) console.info(`    ⚠ ${a}`);
  }

  // Référentiel GREN.
  {
    const chemin = path.join(dossier, TRANSCRIPTIONS_AURA.gren);
    if (!existsSync(chemin)) {
      throw new Error(`Transcription GREN introuvable : ${TRANSCRIPTIONS_AURA.gren}`);
    }
    const t = analyserTranscription(lireJson(chemin));
    const fichiers = verifierDocuments(dossier, t.documents);
    const r = await importerTranscription(t, fichiers);
    console.info(`  ✓ ${t.referentiel.code} — ${t.referentiel.version} : ${r.regles} tables et règles`);
    for (const manque of t.manques) console.info(`    · manque : ${manque.quoi}`);
  }
}
