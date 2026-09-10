/**
 * Qui édite Parcelys, et comment le joindre.
 *
 * Une seule source pour l'accueil, le contact, les CGU et la politique de
 * confidentialité : ces quatre pages doivent dire exactement la même chose, et
 * quatre copies finiraient par diverger — c'est toujours la mention légale
 * oubliée qui devient fausse.
 *
 * Ce qui manque ici manque VRAIMENT : l'adresse postale et le SIRET ne sont pas
 * inventés, et les pages qui en ont besoin le signalent au lieu d'afficher un
 * texte plausible. Une mention légale fausse est pire qu'une mention absente.
 */

export const PARCELYS = {
  nom: 'Parcelys',
  domaine: 'parcelys.fr',
  url: 'https://parcelys.fr',

  /** Kevin Guillot édite et exploite le service. Ce n'est pas un logiciel que d'autres installent. */
  editeur: {
    nom: 'Kevin Guillot',
    qualite: 'exploitant agricole',
    /**
     * Adresse postale et SIRET : à renseigner par Kevin. Tant que ces valeurs
     * sont nulles, les pages légales affichent un avertissement plutôt qu'un
     * texte de remplissage.
     */
    adressePostale: null as string | null,
    siret: null as string | null,
  },

  contact: {
    support: 'support@parcelys.fr',
    /** Les demandes RGPD passent par la même adresse : il n'y a qu'une personne. */
    donneesPersonnelles: 'support@parcelys.fr',
  },

  /**
   * Où tournent les données. Volontairement peu détaillé : nommer la machine et
   * son emplacement exact n'apporte rien à l'utilisateur et renseigne qui
   * chercherait à l'atteindre.
   */
  hebergement: 'Serveur autogéré par l’éditeur, situé en France.',
} as const;

/** Les mentions légales sont-elles complètes ? */
export function mentionsCompletes(): boolean {
  return (
    PARCELYS.editeur.adressePostale !== null && PARCELYS.editeur.siret !== null
  );
}
