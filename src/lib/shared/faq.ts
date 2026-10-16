import { sansAccent } from './texte';
import type { FaqCategorieInitiale } from './faq-initiale';

/**
 * Centre d'aide : forme des données, recherche et mise en forme.
 *
 * Partagé entre le site (rendu serveur et recherche instantanée dans le
 * navigateur) et l'application mobile, qui cherche dans sa copie locale quand
 * le réseau manque. La même fonction de recherche sert partout : un résultat
 * ne dépend pas de l'écran d'où l'on cherche.
 */

export type FaqEntreeVue = {
  id: string;
  slug: string | null;
  question: string;
  answer: string;
  keywords: string | null;
  needsReview: boolean;
  categorySlug: string;
  categoryTitle: string;
};

export type FaqCategorieVue = {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  entries: FaqEntreeVue[];
};

/** Le contenu initial, sous la forme servie par l'API — pour l'usage hors ligne. */
export function faqDepuisInitiale(initiale: FaqCategorieInitiale[]): FaqCategorieVue[] {
  return initiale.map((c) => ({
    id: c.slug,
    slug: c.slug,
    title: c.titre,
    description: c.description,
    entries: c.entrees.map((e) => ({
      id: e.slug,
      slug: e.slug,
      question: e.question,
      answer: e.reponse,
      keywords: e.motsCles ?? null,
      needsReview: e.aVerifier ?? false,
      categorySlug: c.slug,
      categoryTitle: c.titre,
    })),
  }));
}

/** Mots trop courants pour départager quoi que ce soit. */
const MOTS_VIDES = new Set([
  'les', 'des', 'une', 'est', 'que', 'qui', 'pas', 'sur', 'dans', 'avec', 'pour',
  'mon', 'mes', 'ma', 'ton', 'son', 'ses', 'aux', 'par', 'plus', 'comment', 'quoi',
  'quel', 'quelle', 'quels', 'quelles', 'faire', 'peut', 'puis', 'peux', 'est-ce',
  'cette', 'ces', 'votre', 'vos', 'nous', 'vous', 'elle', 'il', 'ils', 'je', 'ne',
]);

export function motsDeRecherche(terme: string): string[] {
  return sansAccent(terme)
    .split(/[^a-z0-9]+/)
    .filter((mot) => mot.length >= 3 && !MOTS_VIDES.has(mot));
}

/**
 * Cherche dans le centre d'aide.
 *
 * Chaque mot tapé est cherché dans la question (poids 3), les mots-clés
 * (2), la réponse et la rubrique (1), sans tenir compte des accents ni de la
 * casse, et par début de mot inclus (« parcel » trouve « parcelles »).
 *
 * Les entrées qui contiennent **tous** les mots passent d'abord ; s'il n'y en
 * a aucune, on se contente de celles qui en contiennent au moins un. Aucune :
 * l'écran propose alors la page Contact.
 */
export function rechercherFaq(categories: FaqCategorieVue[], terme: string): FaqEntreeVue[] {
  const mots = motsDeRecherche(terme);
  if (mots.length === 0) return [];

  const notes: Array<{ entree: FaqEntreeVue; score: number; tous: boolean }> = [];
  for (const categorie of categories) {
    for (const entree of categorie.entries) {
      const question = sansAccent(entree.question);
      const cles = sansAccent(entree.keywords ?? '');
      const reponse = sansAccent(entree.answer);
      const rubrique = sansAccent(categorie.title);
      let score = 0;
      let trouves = 0;
      for (const mot of mots) {
        const s =
          (question.includes(mot) ? 3 : 0) +
          (cles.includes(mot) ? 2 : 0) +
          (reponse.includes(mot) ? 1 : 0) +
          (rubrique.includes(mot) ? 1 : 0);
        if (s > 0) trouves += 1;
        score += s;
      }
      if (score > 0) notes.push({ entree, score, tous: trouves === mots.length });
    }
  }

  const complets = notes.filter((n) => n.tous);
  return (complets.length > 0 ? complets : notes)
    .sort((a, b) => b.score - a.score)
    .map((n) => n.entree);
}

export type BlocReponse = { type: 'p'; texte: string } | { type: 'ul'; items: string[] };

/** Découpe une réponse en paragraphes et listes, sans jamais interpréter de HTML. */
export function blocsDeReponse(reponse: string): BlocReponse[] {
  const blocs: BlocReponse[] = [];
  for (const paragraphe of reponse.split(/\n{2,}/)) {
    const lignes = paragraphe.split('\n').map((l) => l.trim()).filter(Boolean);
    if (lignes.length === 0) continue;
    let liste: string[] = [];
    let texte: string[] = [];
    const vider = () => {
      if (texte.length) blocs.push({ type: 'p', texte: texte.join(' ') });
      if (liste.length) blocs.push({ type: 'ul', items: liste });
      texte = [];
      liste = [];
    };
    for (const ligne of lignes) {
      if (ligne.startsWith('- ')) {
        if (texte.length) {
          blocs.push({ type: 'p', texte: texte.join(' ') });
          texte = [];
        }
        liste.push(ligne.slice(2));
      } else {
        if (liste.length) {
          blocs.push({ type: 'ul', items: liste });
          liste = [];
        }
        texte.push(ligne);
      }
    }
    vider();
  }
  return blocs;
}
