/**
 * Génère les exports PDF d'une exploitation pour les relire à l'œil.
 *
 *   npm run exports:preview -- [--exploitation <id>] [--campagne 2026] [--dossier .preview]
 *
 * Outil de développement : il appelle exactement les mêmes constructeurs de
 * jeux de données et les mêmes rendus que la route `/api/exports`. Rien n'est
 * inventé ici — l'exploitation visée doit exister en base, avec ses données.
 *
 * Comme `scripts/admin.ts`, il est lancé avec `--conditions=react-server`
 * pour que les modules marqués `server-only` se résolvent.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { prisma } from '@/lib/prisma';
import { DATASET_BUILDERS } from '@/lib/exports/datasets';
import { exportFileName, renderPdf } from '@/lib/exports/renderers';
import { currentCampaignYear } from '@/lib/constants/agronomy';

const args = process.argv.slice(2);
const argOf = (name: string): string | undefined => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : undefined;
};

async function main(): Promise<void> {
  const farmId = argOf('exploitation');
  const farm = farmId
    ? await prisma.farm.findUniqueOrThrow({ where: { id: farmId } })
    : await prisma.farm.findFirstOrThrow({
        where: { deletedAt: null },
        orderBy: { createdAt: 'asc' },
      });

  const campaign = argOf('campagne');
  const year = campaign ? Number(campaign) : currentCampaignYear();
  const outDir = path.resolve(argOf('dossier') ?? '.preview');
  await mkdir(outDir, { recursive: true });

  console.log(`Exploitation : ${farm.name} (${farm.id}) — campagne ${year}\n`);

  for (const [name, build] of Object.entries(DATASET_BUILDERS)) {
    const dataset = await build({ farmId: farm.id, farmName: farm.name, year });
    const file = path.join(outDir, exportFileName(dataset, 'pdf'));
    await writeFile(file, await renderPdf(dataset));
    console.log(
      `${name.padEnd(16)} ${String(dataset.rows.length).padStart(4)} ligne(s)  ${file}`,
    );
  }
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
