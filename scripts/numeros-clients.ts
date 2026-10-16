/**
 * Numéros clients : contrôle et reprise.
 *
 *   npm run numeros            # contrôle, et attribue ce qui manque
 *   npm run numeros -- --verifier   # contrôle seul, sans rien écrire
 *
 * La migration 0.11.0 attribue un numéro à chaque exploitation (`EXP-…`) et à
 * chaque technicien (`TEC-…`) qui n'en avait pas. Ce script est son filet :
 * si elle a été interrompue, ou si des lignes sans numéro sont apparues
 * (déclencheur désactivé à la main, restauration partielle), il termine le
 * travail en appelant la même fonction de la base,
 * `parcelys_attribuer_numeros_manquants()`. Celle-ci ne touche qu'aux lignes
 * sans numéro et ne fait jamais redescendre un compteur : on peut la relancer
 * autant de fois qu'on veut.
 *
 * Il ne crée, ne modifie ni ne supprime aucun numéro existant.
 */
import './load-env';
import { prisma } from '@/lib/prisma';

type Bilan = {
  exploitationsSansNumero: number;
  techniciensSansNumero: number;
  doublons: number;
  compteurs: Array<{ prefix: string; lastValue: bigint }>;
  plusGrands: Record<string, number | null>;
};

async function bilan(): Promise<Bilan> {
  const [exploitationsSansNumero, techniciensSansNumero, compteurs] = await Promise.all([
    prisma.farm.count({ where: { customerNumber: null } }),
    prisma.user.count({ where: { accountType: 'AGRONOMIST', technicianNumber: null } }),
    prisma.customerNumberCounter.findMany({ orderBy: { prefix: 'asc' } }),
  ]);

  // L'index unique interdit les doublons ; on le vérifie quand même, parce que
  // c'est précisément ce qu'on cherche à garantir.
  const [ligneDoublons] = await prisma.$queryRaw<Array<{ n: bigint }>>`
    SELECT count(*)::bigint AS n FROM (
      SELECT customer_number FROM farms WHERE customer_number IS NOT NULL
      GROUP BY customer_number HAVING count(*) > 1
      UNION ALL
      SELECT technician_number FROM users WHERE technician_number IS NOT NULL
      GROUP BY technician_number HAVING count(*) > 1
    ) d
  `;

  const [maxima] = await prisma.$queryRaw<
    Array<{ exp: bigint | null; tec: bigint | null; dem: bigint | null }>
  >`
    SELECT
      (SELECT max(substring(customer_number FROM '^EXP-([0-9]+)$')::bigint) FROM farms) AS exp,
      (SELECT max(substring(technician_number FROM '^TEC-([0-9]+)$')::bigint) FROM users) AS tec,
      (SELECT max(substring(number FROM '^DEM-([0-9]+)$')::bigint) FROM support_tickets) AS dem
  `;

  return {
    exploitationsSansNumero,
    techniciensSansNumero,
    doublons: Number(ligneDoublons?.n ?? 0),
    compteurs: compteurs.map((c) => ({ prefix: c.prefix, lastValue: c.lastValue })),
    plusGrands: {
      EXP: maxima?.exp == null ? null : Number(maxima.exp),
      TEC: maxima?.tec == null ? null : Number(maxima.tec),
      DEM: maxima?.dem == null ? null : Number(maxima.dem),
    },
  };
}

function afficher(titre: string, b: Bilan): void {
  console.log(`\n${titre}`);
  console.log(`  exploitations sans numéro : ${b.exploitationsSansNumero}`);
  console.log(`  techniciens sans numéro   : ${b.techniciensSansNumero}`);
  console.log(`  numéros en double         : ${b.doublons}`);
  for (const c of b.compteurs) {
    const max = b.plusGrands[c.prefix];
    const retard = max != null && Number(c.lastValue) < max;
    console.log(
      `  compteur ${c.prefix} : ${c.lastValue}` +
        (max == null ? '' : ` (plus grand numéro attribué : ${max})`) +
        (retard ? '  ← EN RETARD' : ''),
    );
  }
}

async function main(): Promise<void> {
  const verifierSeulement = process.argv.includes('--verifier');

  const avant = await bilan();
  afficher('État actuel', avant);

  const manque = avant.exploitationsSansNumero + avant.techniciensSansNumero;
  const enRetard = avant.compteurs.some((c) => {
    const max = avant.plusGrands[c.prefix];
    return max != null && Number(c.lastValue) < max;
  });

  if (verifierSeulement) {
    process.exitCode = manque > 0 || avant.doublons > 0 || enRetard ? 1 : 0;
    console.log(manque > 0 || enRetard ? '\nReprise nécessaire : lancez « npm run numeros ».' : '\nRien à reprendre.');
    return;
  }

  if (manque === 0 && !enRetard) {
    console.log('\nRien à reprendre.');
    return;
  }

  const [resultat] = await prisma.$queryRaw<Array<{ exploitations: number; techniciens: number }>>`
    SELECT * FROM parcelys_attribuer_numeros_manquants()
  `;
  console.log(
    `\nAttribués : ${resultat?.exploitations ?? 0} exploitation(s), ${resultat?.techniciens ?? 0} technicien(s).`,
  );

  const apres = await bilan();
  afficher('Après reprise', apres);
  if (apres.exploitationsSansNumero + apres.techniciensSansNumero > 0 || apres.doublons > 0) {
    process.exitCode = 1;
    console.error('\nLa reprise n’a pas tout couvert : voir docs/administration.md, « Retour arrière ».');
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
