import { z } from 'zod';

/**
 * Règles transcrites d'un texte réglementaire.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * POURQUOI UNE TRANSCRIPTION
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Le programme d'actions régional nitrates, la liste des zones d'actions
 * renforcées et le référentiel GREN d'Auvergne-Rhône-Alpes ne sont publiés
 * qu'en PDF — deux des arrêtés sont même des scans. Aucun n'existe en jeu de
 * données. Pour qu'une règle soit **appliquée** et non seulement affichée, il
 * faut donc la transcrire.
 *
 * Une transcription n'a de valeur que si l'on peut la confronter au texte.
 * D'où ce format, qui impose pour **chaque** règle :
 *
 *   · le document d'où elle vient, désigné par son empreinte SHA-256 — si le
 *     fichier change, l'import refuse la transcription au lieu d'appliquer
 *     des valeurs relues dans une autre version ;
 *   · l'article et la page ;
 *   · la citation littérale du passage.
 *
 * Et pour le référentiel entier, la liste de **ce qui manque** : ce que le
 * texte renvoie à un autre texte non fourni, ce qui n'a pas pu être relevé.
 * Une donnée absente reste absente ; elle est nommée, pas estimée.
 *
 * Ce module ne lit aucun fichier : il valide. Il est donc utilisable par le
 * script d'import, par le serveur et par les tests.
 */

const dateIso = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date attendue au format AAAA-MM-JJ')
  .refine((v) => !Number.isNaN(new Date(`${v}T00:00:00Z`).getTime()), 'Date invalide');

export const documentSourceSchema = z.object({
  /** Chemin relatif au dossier des référentiels (`data/referentiels-aura`). */
  fichier: z.string().min(3),
  sha256: z.string().regex(/^[0-9a-f]{64}$/, 'Empreinte SHA-256 attendue'),
  titre: z.string().min(10),
  /** Date de signature ou de mise à jour portée par le document. */
  date: dateIso,
  /**
   * Comment le texte a été lu. Un scan ne se lit pas comme un PDF texte : la
   * reconnaissance de caractères se trompe sur les chiffres, et chaque valeur
   * transcrite d'un scan a été vérifiée sur l'image de la page.
   */
  lecture: z.enum(['texte-numerique', 'scan-ocr-verifie-visuellement', 'image-verifiee-visuellement']),
});

export const sourceRegleSchema = z.object({
  document: z.string().min(1),
  article: z.string().min(1),
  page: z.number().int().positive(),
  /** Le passage tel qu'il est écrit. */
  citation: z.string().min(10),
});

export const regleTranscriteSchema = z.object({
  /** Code stable, celui que le moteur cherche. */
  code: z.string().regex(/^[a-z0-9][a-z0-9-]*$/, 'Code en minuscules et tirets'),
  libelle: z.string().min(5),
  domaine: z.enum(['NITRATES', 'GREN', 'COUVERTURE', 'ZONAGE']),
  depuis: dateIso,
  jusquau: dateIso.nullable().default(null),
  /** À quoi la règle s'applique. `null` : à tout le territoire du référentiel. */
  condition: z.record(z.unknown()).nullable().default(null),
  /** Ce que la règle impose. */
  valeur: z.record(z.unknown()),
  unite: z.string().nullable().default(null),
  /** Exceptions écrites dans le texte, reprises telles quelles. */
  exception: z.string().nullable().default(null),
  source: sourceRegleSchema,
});

export const manqueSchema = z.object({
  quoi: z.string().min(3),
  pourquoi: z.string().min(10),
  /** Ce que Parcelys ne peut donc pas faire. */
  consequence: z.string().min(10),
});

export const referentielTranscritSchema = z.object({
  code: z.string().min(2),
  domaine: z.enum(['NITRATES', 'GREN', 'COUVERTURE', 'ZONAGE']),
  nom: z.string().min(5),
  /** Code INSEE de la région (`84` pour l'Auvergne-Rhône-Alpes). */
  territoire: z.string().min(2),
  version: z.string().min(3),
  source: z.string().min(10),
  applicableDu: dateIso,
  applicableAu: dateIso.nullable().default(null),
  /**
   * Une nouvelle version remplace-t-elle les anciennes ? Oui pour un arrêté
   * qui en abroge un autre — l'ancienne version reste lisible pour les
   * campagnes qu'elle a régies, avec sa période d'application.
   */
  remplaceLesVersionsAnterieures: z.boolean(),
  notes: z.array(z.string()).default([]),
});

export const transcriptionSchema = z
  .object({
    format: z.literal('parcelys-transcription/1'),
    referentiel: referentielTranscritSchema,
    documents: z.record(documentSourceSchema),
    regles: z.array(regleTranscriteSchema),
    manques: z.array(manqueSchema).default([]),
  })
  .superRefine((t, ctx) => {
    const codes = new Set<string>();
    t.regles.forEach((regle, index) => {
      if (!t.documents[regle.source.document]) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['regles', index, 'source', 'document'],
          message: `Document « ${regle.source.document} » non déclaré.`,
        });
      }
      // Deux règles du même code ne se distinguent que par leur période : la
      // même clé sur la même période serait une ambiguïté que le moteur
      // trancherait au hasard.
      const cle = `${regle.code}@${regle.depuis}`;
      if (codes.has(cle)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['regles', index, 'code'],
          message: `Règle « ${regle.code} » déclarée deux fois à partir du ${regle.depuis}.`,
        });
      }
      codes.add(cle);
      if (regle.depuis < t.referentiel.applicableDu) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['regles', index, 'depuis'],
          message: 'Une règle ne peut pas précéder l’entrée en vigueur de son référentiel.',
        });
      }
    });
  });

export type Transcription = z.infer<typeof transcriptionSchema>;
export type RegleTranscrite = z.infer<typeof regleTranscriteSchema>;
export type DocumentSource = z.infer<typeof documentSourceSchema>;
export type Manque = z.infer<typeof manqueSchema>;

/**
 * Valide une transcription et rend des erreurs lisibles, chemin compris.
 * Une transcription invalide n'est jamais importée en partie.
 */
export function analyserTranscription(brut: unknown): Transcription {
  const resultat = transcriptionSchema.safeParse(brut);
  if (!resultat.success) {
    const lignes = resultat.error.issues
      .slice(0, 12)
      .map((issue) => `  · ${issue.path.join('.') || '(racine)'} : ${issue.message}`);
    throw new Error(`Transcription invalide :\n${lignes.join('\n')}`);
  }
  return resultat.data;
}

/** Référence lisible d'une règle : « Arrêté n° 24-135 — art. 2, I, 1° (p. 4) ». */
export function referenceDe(transcription: Transcription, regle: RegleTranscrite): string {
  const document = transcription.documents[regle.source.document];
  const titre = document?.titre.split(' relatif')[0]?.split(' modifiant')[0] ?? regle.source.document;
  return `${titre} — ${regle.source.article} (p. ${regle.source.page})`;
}

// ---------------------------------------------------------------------------
// Zones d'actions renforcées
// ---------------------------------------------------------------------------

/**
 * Un captage classé en zone d'actions renforcées.
 *
 * L'arrêté donne une **liste de captages et de communes**, pas de périmètres.
 * Le périmètre d'une ZAR est, selon l'article R. 211-81-1-1 du code de
 * l'environnement tel que le rappelle la fiche DRAAF/DREAL fournie, l'aire
 * d'alimentation du captage lorsqu'elle a été délimitée, sinon les périmètres
 * de protection, sinon les communes.
 *
 * `perimetre` dit lequel de ces cas Parcelys a pu établir, et sur quelle
 * pièce. Le rapprochement d'un captage à son AAC est vérifié à l'import : une
 * AAC qui ne recouperait aucune des communes citées par l'arrêté est refusée.
 */
export const captageZarSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  /** Nom du ou des captages, tel que l'arrêté l'écrit. */
  nom: z.string().min(2),
  regionDuCaptage: z.enum(['AURA', 'BFC']),
  communes: z
    .array(
      z.object({
        /** Nom tel que l'arrêté l'écrit. */
        nom: z.string().min(2),
        insee: z.string().regex(/^(\d{5}|2[AB]\d{3})$/),
        /** D'où vient le code INSEE : jamais de mémoire. */
        sourceInsee: z.string().min(5),
      }),
    )
    .min(1),
  depuis: dateIso,
  source: sourceRegleSchema,
  perimetre: z.discriminatedUnion('type', [
    z.object({
      type: z.literal('aire-alimentation-captage'),
      /** Codes `CdAAC` du référentiel national des AAC. */
      cdAac: z.array(z.string().regex(/^\d+$/)).min(1),
      rapprochement: z.string().min(10),
    }),
    z.object({
      type: z.literal('non-fourni'),
      raison: z.string().min(10),
    }),
  ]),
  /** Points de prélèvement Sandre correspondants, quand ils ont été identifiés. */
  pointsSandre: z.array(z.string().regex(/^PTP\d+$/)).default([]),
});

export const transcriptionZarSchema = z
  .object({
    format: z.literal('parcelys-transcription-zar/1'),
    referentiel: referentielTranscritSchema,
    documents: z.record(documentSourceSchema),
    captages: z.array(captageZarSchema).min(1),
    manques: z.array(manqueSchema).default([]),
  })
  .superRefine((t, ctx) => {
    const ids = new Set<string>();
    t.captages.forEach((captage, index) => {
      if (ids.has(captage.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['captages', index, 'id'],
          message: `Captage « ${captage.id} » déclaré deux fois.`,
        });
      }
      ids.add(captage.id);
      if (!t.documents[captage.source.document]) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['captages', index, 'source', 'document'],
          message: `Document « ${captage.source.document} » non déclaré.`,
        });
      }
    });
  });

export type TranscriptionZar = z.infer<typeof transcriptionZarSchema>;
export type CaptageZar = z.infer<typeof captageZarSchema>;

export function analyserTranscriptionZar(brut: unknown): TranscriptionZar {
  const resultat = transcriptionZarSchema.safeParse(brut);
  if (!resultat.success) {
    const lignes = resultat.error.issues
      .slice(0, 12)
      .map((issue) => `  · ${issue.path.join('.') || '(racine)'} : ${issue.message}`);
    throw new Error(`Transcription des ZAR invalide :\n${lignes.join('\n')}`);
  }
  return resultat.data;
}
