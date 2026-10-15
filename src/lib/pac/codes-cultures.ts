import nomenclature from './codes-cultures.json';

/**
 * Les codes cultures de la déclaration PAC, et leur libellé.
 *
 * TéléPAC désigne chaque culture par un code de trois lettres : « BTH »,
 * « PPH », « MIS ». Un dossier exporté ne porte que ce code — sans libellé —,
 * et Parcelys le prenait pour nom : c'est « PPH » qui s'affichait partout, et
 * le moteur réglementaire, qui reconnaît une culture à son nom, ne savait pas
 * qu'un « BTH » est un blé d'hiver.
 *
 * Le libellé vient de la nomenclature publiée par l'Agence Bio (version et
 * date dans le fichier JSON), jamais de mémoire. Un code absent de la
 * nomenclature n'est pas traduit : il reste affiché tel quel.
 *
 * Le code, lui, ne change pas : c'est lui que TéléPAC attend à l'export.
 */

const CODES: Record<string, string> = nomenclature.codes;

export const SOURCE_CODES_CULTURES = `${nomenclature.source}, version ${nomenclature.version} du ${new Date(
  `${nomenclature.publieLe}T00:00:00Z`,
).toLocaleDateString('fr-FR', { timeZone: 'UTC' })}`;

/** Le libellé d'un code culture PAC, ou `null` s'il n'est pas dans la nomenclature. */
export function libelleCulturePac(code: string | null | undefined): string | null {
  const propre = (code ?? '').trim().toUpperCase();
  if (!propre) return null;
  return CODES[propre] ?? null;
}

/**
 * Ce qu'on affiche pour une culture déclarée : son libellé, sinon le code
 * lui-même — mieux vaut un code qu'un vide.
 */
export function nomCulturePac(code: string | null | undefined): string | null {
  return libelleCulturePac(code) ?? ((code ?? '').trim() || null);
}
