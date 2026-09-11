import 'server-only';
import { prisma } from '@/lib/prisma';

/**
 * Retrouver une parcelle par le nom qu'on lui donne.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * POURQUOI CE N'EST PAS UN `contains` DE PLUS
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * La liste des parcelles cherchait avec `contains` en mode insensible à la
 * casse. Insensible à la casse seulement : « croix » trouvait « Croix », mais
 * « cote » ne trouvait pas « La Côte » et « chene » ne trouvait pas
 * « Le Chêne ».
 *
 * Ce n'est pas un détail de confort. Un import TéléPAC nomme les parcelles
 * « Îlot 39 — parcelle 3 » ; l'exploitant les renomme ensuite avec les noms
 * qu'il emploie vraiment, et ces noms-là sont des noms de lieux français :
 * la Côte, le Chêne, les Prés Salés, le Pré du Curé. Taper l'accent au champ,
 * sur un téléphone, avec des gants, n'arrive pas. Une recherche qui l'exige
 * ne sert donc jamais au moment où elle servirait.
 *
 * `parcelys_sans_accent` est une fonction SQL créée par migration — pas
 * l'extension `unaccent`, qui demande des droits de superutilisateur que la
 * base applicative n'a pas sur le Raspberry Pi.
 *
 * Les cinq champs cherchés sont les cinq façons de désigner une parcelle : son
 * nom, son numéro interne (« 39-3 »), sa commune, son lieu-dit et sa référence
 * cadastrale. Aucune n'est plus légitime que les autres.
 */
export async function identifiantsParcellesTrouvees(
  farmId: string,
  terme: string,
): Promise<string[]> {
  const cherche = terme.trim();
  if (!cherche) return [];

  const lignes = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM parcels
    WHERE farm_id = ${farmId}
      AND deleted_at IS NULL
      AND parcelys_sans_accent(
            coalesce(name, '') || ' ' ||
            coalesce(internal_number, '') || ' ' ||
            coalesce(commune, '') || ' ' ||
            coalesce(lieu_dit, '') || ' ' ||
            coalesce(cadastral_ref, '')
          ) LIKE '%' || parcelys_sans_accent(${cherche}) || '%'
  `;
  return lignes.map((l) => l.id);
}
