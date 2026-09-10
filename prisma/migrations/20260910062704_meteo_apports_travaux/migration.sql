-- Météo sur les apports et les travaux.
--
-- Les index GiST proposés à la suppression par Prisma ont été retirés : ils
-- sont créés en SQL brut, hors de son modèle, et il ne les connaît donc pas.
-- Sans eux, toute recherche spatiale repasse en parcours séquentiel.

-- AlterTable
ALTER TABLE "agricultural_operations" ADD COLUMN     "weather_humidity" DECIMAL(5,1),
ADD COLUMN     "weather_rain_mm" DECIMAL(6,2),
ADD COLUMN     "weather_source" TEXT,
ADD COLUMN     "weather_summary" TEXT,
ADD COLUMN     "weather_temp_c" DECIMAL(5,1),
ADD COLUMN     "weather_wind_kmh" DECIMAL(5,1);

-- AlterTable
ALTER TABLE "fertilizer_applications" ADD COLUMN     "weather_humidity" DECIMAL(5,1),
ADD COLUMN     "weather_rain_mm" DECIMAL(6,2),
ADD COLUMN     "weather_source" TEXT,
ADD COLUMN     "weather_summary" TEXT,
ADD COLUMN     "weather_temp_c" DECIMAL(5,1),
ADD COLUMN     "weather_wind_kmh" DECIMAL(5,1);
