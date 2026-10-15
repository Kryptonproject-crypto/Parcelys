import { describe, expect, it } from 'vitest';
import { classeDeCulture, rappelRiverains, reductionZntAquatique } from '../src/lib/ephy/distances';
import { PULVERISATEUR_NON_RENSEIGNE, type Pulverisateur } from '../src/lib/shared/pulverisateur';

/**
 * Ce que le pulvérisateur déclaré change aux distances : la ZNT des points
 * d'eau et la distance aux habitations. Jamais supposé équipé.
 */
const equipe66: Pulverisateur = {
  type: 'RAMPE',
  reductionDerivePct: 66,
  materiel: 'buses à injection d’air, 3 bar',
  charteRiverains: null,
};
const sansAntiDerive: Pulverisateur = { type: 'RAMPE', reductionDerivePct: 0, materiel: null, charteRiverains: true };
const basse = classeDeCulture({ culture: 'Blé tendre d’hiver', usage: 'Blé*Trt Part.Aer.*Désherbage' });

describe('Culture haute ou basse', () => {
  it('lit la culture de l’usage E-Phy d’abord', () => {
    expect(basse.classe).toBe('basse');
    expect(classeDeCulture({ culture: null, usage: 'Vigne*Trt Part.Aer.*Mildiou' }).classe).toBe('haute');
    expect(classeDeCulture({ culture: null, usage: 'Arbres et arbustes*Trt Part.Aer.*Pucerons' }).classe).toBe('haute');
  });

  it('reconnaît une culture déclarée sans usage', () => {
    expect(classeDeCulture({ culture: 'Maïs (hors maïs doux)', usage: null }).classe).toBe('basse');
    expect(classeDeCulture({ culture: 'Autre prairie temporaire de 5 ans ou moins', usage: null }).classe).toBe('basse');
    expect(classeDeCulture({ culture: 'Noyer', usage: null }).classe).toBe('haute');
  });

  it('ne tranche pas quand la hauteur décide, ni sur un nom inconnu', () => {
    expect(classeDeCulture({ culture: null, usage: 'Fraisier*Trt Part.Aer.*Oïdium' }).classe).toBeNull();
    expect(classeDeCulture({ culture: 'Rosier', usage: null }).classe).toBeNull();
    expect(classeDeCulture({ culture: 'QQQ', usage: null }).classe).toBeNull();
    expect(classeDeCulture({ culture: null, usage: null }).classe).toBeNull();
  });
});

describe('ZNT des points d’eau et pulvérisateur', () => {
  const vingt = { origine: 'usage' as const, metres: 20, ecrit: '20.0' };

  it('ramène 20 m à 5 m avec un matériel d’au moins 66 %, sous les conditions de l’annexe 3', () => {
    const r = reductionZntAquatique({ produit: 'P', aquatique: vingt, conditions: [], pulverisateur: equipe66 })!;
    expect(r).toContain('ramenée à 5 m');
    expect(r).toContain('dispositif végétalisé permanent d’au moins 5 m');
    expect(r).toContain('enregistré au registre');
    expect(r).toContain('Sans dispositif végétalisé : 20 m');
    expect(r).toContain('buses à injection d’air');
    expect(r).toContain('annexe 3');
  });

  it('refuse la réduction sans matériel suffisant', () => {
    const r = reductionZntAquatique({ produit: 'P', aquatique: vingt, conditions: [], pulverisateur: sansAntiDerive })!;
    expect(r).toContain('non réductible avec votre pulvérisateur');
    expect(r).toContain('aucun moyen anti-dérive déclaré');
    const cinquante = { ...sansAntiDerive, reductionDerivePct: 50 };
    expect(reductionZntAquatique({ produit: 'P', aquatique: vingt, conditions: [], pulverisateur: cinquante })).toContain(
      'déclarée : 50 %',
    );
  });

  it('dit ce que demanderait la réduction quand le pulvérisateur n’est pas renseigné', () => {
    const r = reductionZntAquatique({ produit: 'P', aquatique: vingt, conditions: [], pulverisateur: PULVERISATEUR_NON_RENSEIGNE })!;
    expect(r).toContain('réductible à 5 m avec un moyen inscrit sur la liste officielle');
    expect(r).toContain('Renseignez votre pulvérisateur');
  });

  it('ne réduit jamais 100 m, et ne dit rien de 5 m', () => {
    const cent = { origine: 'usage' as const, metres: 100, ecrit: '100' };
    expect(reductionZntAquatique({ produit: 'P', aquatique: cent, conditions: [], pulverisateur: equipe66 })).toContain(
      'non réductible, quel que soit le matériel',
    );
    const cinq = { origine: 'defaut' as const, metres: 5 };
    expect(reductionZntAquatique({ produit: 'P', aquatique: cinq, conditions: [], pulverisateur: equipe66 })).toBeNull();
  });

  it('laisse l’étiquette trancher quand l’autorisation impose un dispositif végétalisé', () => {
    const r = reductionZntAquatique({
      produit: 'P',
      aquatique: vingt,
      conditions: [{ label: 'SPe 3 : respecter une zone non traitée de 20 m comportant un dispositif végétalisé permanent non traité de 20 m en bordure des points d’eau.' }],
      pulverisateur: equipe66,
    });
    expect(r).toContain('se lit sur l’étiquette');
    expect(r).toContain('« SPe 3 : respecter une zone non traitée de 20 m comportant un dispositif végétalisé');
    expect(r).not.toContain('ramenée à 5 m');
    // Une bande végétalisée qui ne vise pas l'eau ne compte pas.
    const ailleurs = reductionZntAquatique({
      produit: 'P',
      aquatique: vingt,
      conditions: [{ label: 'Respecter une zone sans apport équipée d’un dispositif végétalisé permanent.' }],
      pulverisateur: equipe66,
    });
    expect(ailleurs).toContain('ramenée à 5 m');
  });
});

describe('Distance aux habitations', () => {
  const base = { produit: 'P', mentionsAutorisees: null, dangers: [], conditions: [], culture: basse };

  it('5 m en culture basse, 3 m avec un matériel d’au moins 66 % et la charte', () => {
    expect(rappelRiverains({ ...base, pulverisateur: { ...equipe66, charteRiverains: true } })).toContain(
      '3 m avec votre pulvérisateur',
    );
    // Charte non renseignée : la réduction est dite sous condition.
    const sansCharte = rappelRiverains({ ...base, pulverisateur: equipe66 });
    expect(sansCharte).toContain('5 m');
    expect(sansCharte).toContain('si vous appliquez la charte');
    // Charte non appliquée, ou matériel insuffisant : 5 m.
    expect(rappelRiverains({ ...base, pulverisateur: { ...equipe66, charteRiverains: false } })).toContain(
      'demande d’appliquer la charte',
    );
    expect(rappelRiverains({ ...base, pulverisateur: sansAntiDerive })).toContain('demande un matériel réduisant la dérive d’au moins 66 %');
    // 50 % ne suffit pas, même avec la charte.
    const a50 = rappelRiverains({ ...base, pulverisateur: { ...equipe66, reductionDerivePct: 50, charteRiverains: true } });
    expect(a50).toContain('5 m (culture basse');
    expect(a50).not.toContain('3 m avec votre pulvérisateur');
    expect(rappelRiverains({ ...base, pulverisateur: PULVERISATEUR_NON_RENSEIGNE })).toMatch(/renseignez votre pulvérisateur/i);
  });

  it('10 m en culture haute, sans chiffrer la réduction', () => {
    const haute = classeDeCulture({ culture: null, usage: 'Vigne*Trt Part.Aer.*Mildiou' });
    const r = rappelRiverains({ ...base, culture: haute, pulverisateur: equipe66 });
    expect(r).toContain('10 m (culture haute');
    expect(r).toContain('ne chiffre pas');
  });

  it('20 m incompressibles pour les mentions de danger les plus graves', () => {
    const r = rappelRiverains({
      ...base,
      dangers: [{ code: 'H360Df', label: 'Peut nuire au fœtus. Susceptible de nuire à la fertilité.' }],
      pulverisateur: { ...equipe66, reductionDerivePct: 90, charteRiverains: true },
    });
    expect(r).toContain('20 m des habitations, incompressibles');
    expect(r).toContain('H360Df');
    expect(r).not.toContain('3 m');
  });

  it('ne tranche pas pour un CMR 2 : la liste ministérielle n’est pas importée', () => {
    const r = rappelRiverains({
      ...base,
      dangers: [
        { code: 'H302', label: 'Nocif en cas d’ingestion' },
        { code: 'H351', label: 'Susceptible de provoquer le cancer.' },
      ],
      pulverisateur: equipe66,
    });
    expect(r).toContain('distance indéterminée');
    expect(r).toContain('10 m incompressibles s’il figure sur la liste');
    expect(r).toContain('H351 (Susceptible de provoquer le cancer)');
    expect(r).not.toContain('H302');
  });

  it('exempte biocontrôle et faible risque', () => {
    expect(rappelRiverains({ ...base, mentionsAutorisees: 'Liste biocontrôle', pulverisateur: equipe66 })).toContain(
      'pas de distance réglementaire',
    );
  });

  it('l’autorisation du produit prévaut, et son option se choisit selon le matériel', () => {
    const conditions = [
      {
        category: 'Riverains',
        label:
          "Condition: Respecter une distance d'au moins 10 mètres entre la rampe de pulvérisation et : - l'espace fréquenté par les personnes présentes lors du traitement . - l'espace susceptible d'être fréquenté par des résidents et utiliser un matériel permettant une atténuation de la dérive d'au moins 90 %. Ou à défaut, Respecter une distance d'au moins 20 mètres entre la rampe de pulvérisation et : - l'espace fréquenté par les personnes présentes lors du traitement . - l'espace susceptible d'être fréquenté par des résidents et utiliser un matériel permettant une atténuation de la dérive d'au moins 66 %.",
      },
    ];
    // Même un produit à 20 m réglementaires suit son autorisation.
    const dangers = [{ code: 'H351', label: null }];
    expect(rappelRiverains({ ...base, conditions, dangers, pulverisateur: equipe66 })).toContain('20 m des habitations avec votre pulvérisateur');
    expect(
      rappelRiverains({ ...base, conditions, dangers, pulverisateur: { ...equipe66, reductionDerivePct: 90 } }),
    ).toContain('10 m des habitations avec votre pulvérisateur');
    expect(rappelRiverains({ ...base, conditions, dangers, pulverisateur: sansAntiDerive })).toContain(
      'aucune option de l’autorisation ne correspond',
    );
    expect(rappelRiverains({ ...base, conditions, dangers, pulverisateur: PULVERISATEUR_NON_RENSEIGNE })).toContain(
      'Renseignez votre pulvérisateur',
    );
  });

  it('une distance sans exigence de matériel s’applique telle quelle', () => {
    const conditions = [
      {
        category: 'Riverains',
        label:
          "Condition: Respecter une distance d'au moins 3 mètres entre la rampe de pulvérisation et : - l'espace fréquenté par les personnes présentes lors du traitement . - l'espace susceptible d'être fréquenté par des résidents.",
      },
    ];
    expect(rappelRiverains({ ...base, conditions, pulverisateur: PULVERISATEUR_NON_RENSEIGNE })).toContain(
      '3 m des habitations, fixés par l’autorisation du produit',
    );
  });

  it('cite le texte quand sa portée dépend de l’usage', () => {
    const conditions = [
      { category: 'Riverains', label: "Condition: Pour les usages sur 'vigne', respecter une distance d'au moins 10 mètres entre le dernier rang traité et les résidents." },
      { category: 'Riverains', label: "Condition: Pour les usages sur 'blé', respecter une distance d'au moins 3 mètres entre la rampe de pulvérisation et les résidents." },
    ];
    const r = rappelRiverains({ ...base, conditions, pulverisateur: equipe66 });
    expect(r).toContain('selon l’usage');
    expect(r).toContain('« Pour les usages sur \'blé\'');
  });
});
