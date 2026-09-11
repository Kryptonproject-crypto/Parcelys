/**
 * Pose le terrain d'essai de l'audit, et rend ses identifiants.
 *
 *   npx tsx --conditions=react-server scripts/audit-fixtures.ts
 *
 * Le seed crée une exploitation de démonstration dont le propriétaire est aussi
 * administrateur d'instance. C'est commode pour démarrer, et insuffisant pour
 * auditer : on ne peut pas vérifier qu'une page d'administration est **refusée**
 * à un exploitant si le seul exploitant disponible est administrateur.
 *
 * Ce script ajoute donc ce qui manque, sans toucher à la démonstration :
 *
 *   · un exploitant **ordinaire**, avec sa propre exploitation et ses parcelles ;
 *   · un **expert agronomique** en mission sur cette exploitation ;
 *   · un **voisin**, pour éprouver le cloisonnement.
 *
 * Il est rejouable : il retrouve les comptes par leur adresse plutôt que d'en
 * créer de nouveaux à chaque passage.
 *
 * Il rend un JSON sur la sortie standard — les identifiants réels que les
 * scripts d'audit emploient pour visiter les pages à paramètre. Visiter
 * `/parcelles/<inventé>` ne testerait que la page 404.
 */
import './load-env';
import bcrypt from 'bcryptjs';
import { prisma } from '@/lib/prisma';
import { saveParcelGeometry } from '@/lib/geo/repository';
import { campagneCourante } from '@/lib/shared/campagne';

const MOT_DE_PASSE = 'AuditParcelys1';

/** Un rectangle en WGS84, quelque part en Beauce. */
function rectangle(lng: number, lat: number, dLng: number, dLat: number) {
  return {
    type: 'Polygon' as const,
    coordinates: [
      [
        [lng, lat],
        [lng + dLng, lat],
        [lng + dLng, lat + dLat],
        [lng, lat + dLat],
        [lng, lat],
      ],
    ],
  };
}

async function compte(params: {
  email: string;
  prenom: string;
  nom: string;
  accountType?: 'FARMER' | 'AGRONOMIST' | 'ADMIN';
  admin?: boolean;
}) {
  const emailNormalized = params.email.toLowerCase();
  const existant = await prisma.user.findUnique({ where: { emailNormalized } });
  if (existant) return existant;
  return prisma.user.create({
    data: {
      email: params.email,
      emailNormalized,
      passwordHash: await bcrypt.hash(MOT_DE_PASSE, 10),
      firstName: params.prenom,
      lastName: params.nom,
      emailVerifiedAt: new Date(),
      accountType: params.accountType ?? 'FARMER',
      isPlatformAdmin: params.admin ?? false,
      acceptedTermsAt: new Date(),
      acceptedPrivacyAt: new Date(),
    },
  });
}

async function main() {
  const annee = campagneCourante();

  // --- L'exploitant ordinaire et son exploitation ------------------------
  const exploitant = await compte({
    email: 'audit.exploitant@parcelys.test',
    prenom: 'Audit',
    nom: 'Exploitant',
  });

  let ferme = await prisma.farm.findFirst({
    where: { name: 'Ferme d’audit', deletedAt: null },
    select: { id: true },
  });
  if (!ferme) {
    ferme = await prisma.farm.create({
      data: {
        name: 'Ferme d’audit',
        siret: '00000000000000',
        city: 'Sainte-Test',
        department: '28',
        members: { create: { userId: exploitant.id, role: 'OWNER' } },
      },
      select: { id: true },
    });
  }

  // --- Des parcelles, avec géométrie et culture --------------------------
  const parcellesVoulues = [
    { nom: 'La Croix Rouge', numero: 'A-01', lng: 1.7, lat: 48.2 },
    { nom: 'Le Grand Pré', numero: 'A-02', lng: 1.72, lat: 48.2 },
    { nom: 'La Côte du Chêne', numero: 'A-03', lng: 1.74, lat: 48.2 },
  ];
  const parcelIds: string[] = [];

  for (const voulue of parcellesVoulues) {
    let parcelle = await prisma.parcel.findFirst({
      where: { farmId: ferme.id, internalNumber: voulue.numero, deletedAt: null },
      select: { id: true },
    });
    if (!parcelle) {
      parcelle = await prisma.parcel.create({
        data: {
          farmId: ferme.id,
          name: voulue.nom,
          internalNumber: voulue.numero,
          commune: 'Sainte-Test',
          inseeCode: '28000',
          lieuDit: 'Les Sauvattes',
          parcelType: 'Terre labourable',
          areaHa: 0,
        },
        select: { id: true },
      });
      await prisma.$transaction(async (tx) => {
        await saveParcelGeometry(
          tx,
          parcelle!.id,
          rectangle(voulue.lng, voulue.lat, 0.01, 0.006) as never,
          'audit',
        );
      });
    }
    parcelIds.push(parcelle.id);
  }

  // --- Une culture sur la campagne en cours ------------------------------
  const ble = await prisma.crop.findFirst({ where: { code: 'BLE_TENDRE' }, select: { id: true } });
  if (ble) {
    for (const parcelId of parcelIds) {
      const deja = await prisma.cropYear.findFirst({
        where: { parcelId, campaignYear: annee },
        select: { id: true },
      });
      if (!deja) {
        await prisma.cropYear.create({
          data: { parcelId, cropId: ble.id, campaignYear: annee },
        });
      }
    }
  }

  // --- L'expert agronomique, en mission sur cette exploitation -----------
  const expert = await compte({
    email: 'audit.expert@parcelys.test',
    prenom: 'Audit',
    nom: 'Expert',
    accountType: 'AGRONOMIST',
  });
  const mission = await prisma.advisoryEngagement.findFirst({
    where: { farmId: ferme.id, expertId: expert.id },
    select: { id: true },
  });
  if (!mission) {
    await prisma.advisoryEngagement.create({
      data: { farmId: ferme.id, expertId: expert.id, status: 'ACTIVE' },
    });
  }

  // --- Le voisin, pour éprouver le cloisonnement -------------------------
  const voisin = await compte({
    email: 'audit.voisin@parcelys.test',
    prenom: 'Audit',
    nom: 'Voisin',
  });
  let fermeVoisine = await prisma.farm.findFirst({
    where: { name: 'Ferme voisine d’audit', deletedAt: null },
    select: { id: true },
  });
  if (!fermeVoisine) {
    fermeVoisine = await prisma.farm.create({
      data: {
        name: 'Ferme voisine d’audit',
        members: { create: { userId: voisin.id, role: 'OWNER' } },
      },
      select: { id: true },
    });
  }
  let parcelleVoisine = await prisma.parcel.findFirst({
    where: { farmId: fermeVoisine.id, deletedAt: null },
    select: { id: true },
  });
  if (!parcelleVoisine) {
    parcelleVoisine = await prisma.parcel.create({
      data: {
        farmId: fermeVoisine.id,
        name: 'La parcelle du voisin',
        internalNumber: 'V-01',
        areaHa: 4.2,
      },
      select: { id: true },
    });
  }

  // --- Un lot de stock, pour la page qui l'affiche -----------------------
  const lot = await prisma.stockLot.findFirst({
    where: { item: { farmId: ferme.id } },
    select: { id: true },
  });

  /*
   * --- L'administrateur d'audit ------------------------------------------
   *
   * Le sien, et non celui du seed. Une base de développement accumule les
   * comptes administrateurs laissés par les essais précédents ; prendre « le
   * plus ancien » revient à prendre un compte dont on ignore le mot de passe,
   * et l'audit échoue alors à la connexion pour une raison qui n'est pas celle
   * qu'il cherchait.
   */
  const admin = await compte({
    email: 'audit.admin@parcelys.test',
    prenom: 'Audit',
    nom: 'Administration',
    accountType: 'ADMIN',
    admin: true,
  });

  console.info(
    JSON.stringify(
      {
        motDePasse: MOT_DE_PASSE,
        exploitantEmail: exploitant.email,
        expertEmail: expert.email,
        voisinEmail: voisin.email,
        adminEmail: admin.email,
        farmId: ferme.id,
        farmVoisineId: fermeVoisine.id,
        parcelId: parcelIds[0] ?? null,
        parcelIds,
        parcelVoisineId: parcelleVoisine.id,
        lotId: lot?.id ?? null,
        campagne: annee,
      },
      null,
      2,
    ),
  );
}

main().finally(() => prisma.$disconnect());
