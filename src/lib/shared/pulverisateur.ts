/**
 * Le pulvérisateur de l'exploitation, tel que l'exploitant le déclare.
 *
 * Partagé entre le formulaire des paramètres et le contrôle des traitements :
 * les mêmes libellés des deux côtés, et les mêmes classes de réduction de
 * dérive — celles de la liste officielle des moyens réduisant la dérive,
 * publiée au Bulletin officiel du ministère de l'Agriculture.
 */

export const TYPES_PULVERISATEUR = ['RAMPE', 'JET_PORTE', 'PNEUMATIQUE', 'A_DOS', 'AUTRE'] as const;
export type TypePulverisateur = (typeof TYPES_PULVERISATEUR)[number];

export const LIBELLES_TYPE_PULVERISATEUR: Record<TypePulverisateur, string> = {
  RAMPE: 'Pulvérisateur à rampe (porté, traîné ou automoteur)',
  JET_PORTE: 'Pulvérisateur à jet porté (vigne, vergers)',
  PNEUMATIQUE: 'Pulvérisateur pneumatique',
  A_DOS: 'Pulvérisateur à dos ou lance',
  AUTRE: 'Autre pulvérisateur',
};

/**
 * Réduction de dérive déclarée, en %.
 *
 * `0` : aucun moyen anti-dérive. Les autres valeurs sont les classes de la
 * liste officielle : c'est elle qui donne, pour un modèle de buse et une
 * pression, la réduction reconnue.
 */
export const CLASSES_REDUCTION_DERIVE = [0, 50, 66, 75, 90] as const;
export type ClasseReductionDerive = (typeof CLASSES_REDUCTION_DERIVE)[number];

export type Pulverisateur = {
  type: TypePulverisateur | null;
  /** `null` : non renseigné — jamais supposé équipé, ni supposé non équipé. */
  reductionDerivePct: number | null;
  materiel: string | null;
  /** Charte d'engagements départementale (riverains) appliquée ; `null` : non renseigné. */
  charteRiverains: boolean | null;
};

export const PULVERISATEUR_NON_RENSEIGNE: Pulverisateur = {
  type: null,
  reductionDerivePct: null,
  materiel: null,
  charteRiverains: null,
};
