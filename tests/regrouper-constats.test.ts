import { describe, expect, it } from 'vitest';
import { regrouperConstats } from '../src/lib/regulatory/regrouper-constats';
import type { Finding } from '../src/lib/regulatory/compliance';

const zv = (parcelId: string): Finding => ({
  domain: 'ZONAGE',
  level: 'VERIFICATION',
  code: 'zv.appartenance',
  title: 'Parcelle en zone vulnérable',
  detail: `« ${parcelId} » est en zone vulnérable.`,
  action: 'Les prescriptions du programme d’actions s’appliquent.',
  sourceLabel: 'DREAL',
  referentialVersion: '2021',
  parcelId,
});

describe('Regroupement des constats', () => {
  it('réunit les constats identiques et garde le détail de chacun', () => {
    const groupes = regrouperConstats([zv('a'), zv('b'), zv('c')]);
    expect(groupes).toHaveLength(1);
    expect(groupes[0]!.constats.map((c) => c.parcelId)).toEqual(['a', 'b', 'c']);
  });

  it('ne réunit pas ce qui diffère : niveau, version de la source, action', () => {
    const groupes = regrouperConstats([
      zv('a'),
      { ...zv('b'), level: 'ANOMALIE' },
      { ...zv('c'), referentialVersion: '2024' },
      { ...zv('d'), action: undefined },
    ]);
    expect(groupes).toHaveLength(4);
  });

  it('met l’anomalie en tête, même seule face à cent vérifications', () => {
    const cent = Array.from({ length: 100 }, (_, i) => zv(`p${i}`));
    const groupes = regrouperConstats([...cent, { ...zv('x'), level: 'ANOMALIE', title: 'Dose dépassée', code: 'dose' }]);
    expect(groupes[0]!.level).toBe('ANOMALIE');
    expect(groupes[1]!.constats).toHaveLength(100);
  });
});
