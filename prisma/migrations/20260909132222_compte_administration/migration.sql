-- Nouveau type de compte : l'administrateur d'instance.
--
-- Un compte ADMIN n'a ni exploitation ni portefeuille de conseil. Le droit
-- d'administrer reste porté par `is_platform_admin` : les comptes existants,
-- exploitants et administrateurs à la fois, continuent de fonctionner tels
-- quels. Ce type désigne un compte créé *pour* l'administration.
ALTER TYPE "AccountType" ADD VALUE 'ADMIN';

-- Prisma proposait ici de supprimer les trois index GiST (parcel_geometries,
-- pac_ilots, pac_features). Ils sont créés en SQL brut, hors du modèle Prisma,
-- qui ne les connaît donc pas et les croit superflus. Les supprimer priverait
-- d'index spatial toutes les géométries : chaque affichage de carte et chaque
-- recherche de chevauchement repasserait en parcours séquentiel. On les garde.
