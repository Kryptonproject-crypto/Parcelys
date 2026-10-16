import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createExpert, createUserWithFarm, prisma, resetDatabase } from './helpers/db';
import { formaterNumero, lireNumero } from '../src/lib/shared/numeros';

/**
 * Numéros clients : `EXP-000001`, `TEC-000001`, `DEM-000001`.
 *
 * Vérifiés au niveau de la base, là où ils sont attribués : les déclencheurs
 * et le compteur de la migration 0.11.0. Les compteurs ne se réinitialisent
 * jamais — y compris entre deux tests — : on compare donc les numéros entre
 * eux, jamais à « 000001 ».
 */

const valeur = (numero: string | null | undefined): number => Number(numero?.split('-')[1]);

async function compteur(prefixe: string): Promise<number> {
  const row = await prisma.customerNumberCounter.findUniqueOrThrow({ where: { prefix: prefixe } });
  return Number(row.lastValue);
}

describe('Numéros clients', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('attribue un numéro EXP-xxxxxx à chaque exploitation créée, sans intervention du code', async () => {
    const avant = await compteur('EXP');
    const a = await prisma.farm.create({ data: { name: 'Ferme A' } });
    const b = await prisma.farm.create({ data: { name: 'Ferme B' } });

    expect(a.customerNumber).toMatch(/^EXP-\d{6}$/);
    expect(b.customerNumber).toMatch(/^EXP-\d{6}$/);
    expect(valeur(a.customerNumber)).toBe(avant + 1);
    expect(valeur(b.customerNumber)).toBe(avant + 2);
  });

  it('ignore un numéro fourni à la création : seul le compteur attribue', async () => {
    const farm = await prisma.farm.create({ data: { name: 'Ferme imposée', customerNumber: 'EXP-999999' } });
    expect(farm.customerNumber).not.toBe('EXP-999999');
    expect(farm.customerNumber).toMatch(/^EXP-\d{6}$/);
  });

  it('reste unique sous 25 créations simultanées', async () => {
    const avant = await compteur('EXP');
    const fermes = await Promise.all(
      Array.from({ length: 25 }, (_, i) => prisma.farm.create({ data: { name: `Concurrente ${i}` } })),
    );
    const numeros = fermes.map((f) => f.customerNumber);
    expect(new Set(numeros).size).toBe(25);
    // Aucun trou, aucun doublon : exactement les 25 valeurs suivantes.
    expect(numeros.map(valeur).sort((x, y) => x - y)).toEqual(
      Array.from({ length: 25 }, (_, i) => avant + 1 + i),
    );
  });

  it('ne réattribue jamais un numéro, même après suppression définitive', async () => {
    const farm = await prisma.farm.create({ data: { name: 'Éphémère' } });
    await prisma.farm.delete({ where: { id: farm.id } });
    const suivante = await prisma.farm.create({ data: { name: 'Suivante' } });
    expect(valeur(suivante.customerNumber)).toBe(valeur(farm.customerNumber) + 1);
  });

  it('refuse de modifier ou d’effacer un numéro attribué', async () => {
    const farm = await prisma.farm.create({ data: { name: 'Stable' } });
    await expect(
      prisma.farm.update({ where: { id: farm.id }, data: { customerNumber: 'EXP-000042' } }),
    ).rejects.toThrow(/définitif/);
    await expect(
      prisma.farm.update({ where: { id: farm.id }, data: { customerNumber: null } }),
    ).rejects.toThrow(/définitif/);
    // Une modification ordinaire passe, et le numéro ne bouge pas.
    const renommee = await prisma.farm.update({ where: { id: farm.id }, data: { name: 'Renommée' } });
    expect(renommee.customerNumber).toBe(farm.customerNumber);
  });

  it('ne laisse ni redescendre, ni supprimer, ni vider un compteur', async () => {
    await expect(
      prisma.$executeRawUnsafe(`UPDATE customer_number_counters SET last_value = 0 WHERE prefix = 'EXP'`),
    ).rejects.toThrow(/redescend/);
    await expect(
      prisma.$executeRawUnsafe(`DELETE FROM customer_number_counters WHERE prefix = 'TEC'`),
    ).rejects.toThrow(/supprimé/);
    await expect(prisma.$executeRawUnsafe(`TRUNCATE customer_number_counters`)).rejects.toThrow(/vidés/);
  });

  it('attribue un TEC-xxxxxx aux techniciens, et à eux seuls', async () => {
    const avant = await compteur('TEC');
    const expert = await createExpert({ email: 'tec@cabinet.test' });
    const exploitant = await createUserWithFarm({ email: 'ferme@ferme.test', farmName: 'Ferme' });

    const tech = await prisma.user.findUniqueOrThrow({ where: { id: expert.id } });
    const farmer = await prisma.user.findUniqueOrThrow({ where: { id: exploitant.id } });
    expect(tech.technicianNumber).toMatch(/^TEC-\d{6}$/);
    expect(valeur(tech.technicianNumber)).toBe(avant + 1);
    expect(farmer.technicianNumber).toBeNull();

    // Un compte qui devient technicien reçoit son numéro à ce moment-là.
    const devenu = await prisma.user.update({
      where: { id: exploitant.id },
      data: { accountType: 'AGRONOMIST' },
    });
    expect(valeur(devenu.technicianNumber)).toBe(avant + 2);
    // Et le garde s'il cesse de l'être.
    const redevenu = await prisma.user.update({
      where: { id: exploitant.id },
      data: { accountType: 'FARMER' },
    });
    expect(redevenu.technicianNumber).toBe(devenu.technicianNumber);
  });

  it('interdit à un compte d’être administrateur général et secondaire à la fois', async () => {
    const admin = await createUserWithFarm({ email: 'g@x.test', farmName: 'G', platformAdmin: true });
    await expect(
      prisma.user.update({ where: { id: admin.id }, data: { isSecondaryAdmin: true } }),
    ).rejects.toThrow(/users_un_seul_niveau_admin/);
  });

  describe('Reprise des comptes et exploitations existants', () => {
    /**
     * Simule des lignes antérieures à la migration : insérées déclencheurs
     * désactivés, donc sans numéro. La fonction de reprise, celle qu'appellent
     * la migration et `npm run numeros`, doit les numéroter dans l'ordre de
     * création, sans toucher aux numéros existants, et pouvoir être relancée.
     */
    async function insererSansNumero(nom: string, createdAt: Date): Promise<string> {
      await prisma.$executeRawUnsafe(`ALTER TABLE farms DISABLE TRIGGER farms_numero_client`);
      try {
        const id = `reprise-${nom}`;
        await prisma.$executeRaw`
          INSERT INTO farms (id, name, country, is_demo, created_at, updated_at)
          VALUES (${id}, ${nom}, 'FR', false, ${createdAt}, now())
        `;
        return id;
      } finally {
        await prisma.$executeRawUnsafe(`ALTER TABLE farms ENABLE TRIGGER farms_numero_client`);
      }
    }

    it('numérote les lignes sans numéro dans l’ordre de création, sans toucher aux autres', async () => {
      const existante = await prisma.farm.create({ data: { name: 'Déjà numérotée' } });
      const recente = await insererSansNumero('recente', new Date('2026-05-01'));
      const ancienne = await insererSansNumero('ancienne', new Date('2024-01-01'));
      const avant = await compteur('EXP');

      const [resultat] = await prisma.$queryRaw<Array<{ exploitations: number }>>`
        SELECT * FROM parcelys_attribuer_numeros_manquants()
      `;
      expect(resultat?.exploitations).toBe(2);

      const lues = await prisma.farm.findMany({
        where: { id: { in: [existante.id, recente, ancienne] } },
        select: { id: true, customerNumber: true },
      });
      const num = new Map(lues.map((f) => [f.id, f.customerNumber]));
      expect(num.get(existante.id)).toBe(existante.customerNumber);
      expect(valeur(num.get(ancienne))).toBe(avant + 1);
      expect(valeur(num.get(recente))).toBe(avant + 2);

      // Relancée : rien à faire, rien ne change.
      const [encore] = await prisma.$queryRaw<Array<{ exploitations: number }>>`
        SELECT * FROM parcelys_attribuer_numeros_manquants()
      `;
      expect(encore?.exploitations).toBe(0);
      expect(await compteur('EXP')).toBe(avant + 2);
    });

    it('réaligne un compteur en retard sur le plus grand numéro présent', async () => {
      const base = await compteur('EXP');
      // Un numéro posé « à la main », déclencheur désactivé (import, restauration partielle).
      await prisma.$executeRawUnsafe(`ALTER TABLE farms DISABLE TRIGGER farms_numero_client`);
      try {
        await prisma.$executeRaw`
          INSERT INTO farms (id, name, country, is_demo, customer_number, created_at, updated_at)
          VALUES ('reprise-importee', 'Importée', 'FR', false, ${formaterNumero('EXP', base + 50)}, now(), now())
        `;
      } finally {
        await prisma.$executeRawUnsafe(`ALTER TABLE farms ENABLE TRIGGER farms_numero_client`);
      }
      await prisma.$queryRaw`SELECT * FROM parcelys_attribuer_numeros_manquants()`;
      expect(await compteur('EXP')).toBe(base + 50);
      const suivante = await prisma.farm.create({ data: { name: 'Après réalignement' } });
      expect(valeur(suivante.customerNumber)).toBe(base + 51);
    });
  });
});

describe('Lecture d’un numéro tapé', () => {
  it('reconnaît les variantes de saisie', () => {
    expect(lireNumero('exp-12')?.numero).toBe('EXP-000012');
    expect(lireNumero(' EXP 000012 ')?.numero).toBe('EXP-000012');
    expect(lireNumero('EXP000012')?.numero).toBe('EXP-000012');
    expect(lireNumero('tec–7')?.numero).toBe('TEC-000007');
    expect(lireNumero('DEM-1234567')?.numero).toBe('DEM-1234567');
  });

  it('refuse ce qui n’est pas un numéro', () => {
    for (const saisie of ['12', 'EXP-', 'EXP-0', 'ABC-000001', 'EXP-12a', '', null]) {
      expect(lireNumero(saisie)).toBeNull();
    }
  });

  it('ne tronque jamais au-delà de six chiffres', () => {
    expect(formaterNumero('EXP', 1)).toBe('EXP-000001');
    expect(formaterNumero('EXP', 1_234_567)).toBe('EXP-1234567');
  });
});
