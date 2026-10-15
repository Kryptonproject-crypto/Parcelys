-- Empreinte du contexte réglementaire d'une parcelle : ce dont son calcul
-- dépendait. Un contexte dont l'empreinte est inchangée est relu tel quel ;
-- les contextes existants, sans empreinte, seront recalculés à leur prochaine
-- lecture.
ALTER TABLE "parcel_regulatory_contexts" ADD COLUMN "empreinte" TEXT;
