-- Parcelys 0.11.0 — administration multi-niveaux, numéros clients, support, aide.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- CE QUE FAIT CETTE MIGRATION, ET CE QU'ELLE NE FAIT PAS
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Elle **ajoute** : des colonnes facultatives, des tables, des index, des
-- fonctions et des déclencheurs. Elle ne supprime rien, ne renomme rien, et ne
-- réécrit aucune donnée existante — sauf pour remplir les numéros clients
-- encore vides, ce qui est son objet.
--
-- Les administrateurs existants (`is_platform_admin`) deviennent, sans rien
-- changer à leur ligne, les administrateurs **généraux** : le sens de la
-- colonne est conservé. Le niveau secondaire est une colonne nouvelle, fausse
-- pour tout le monde.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- REJOUABLE
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Chaque instruction est écrite pour pouvoir être relancée sans erreur
-- (`IF NOT EXISTS`, `CREATE OR REPLACE`, contraintes supprimées puis recréées).
-- Si la migration s'interrompt sur le Raspberry Pi — coupure, carte pleine —,
-- on la marque comme annulée (`npx prisma migrate resolve --rolled-back
-- 20261017090000_administration_multi_niveaux`) puis on relance
-- `npx prisma migrate deploy` : ce qui était déjà fait est reconnu, le reste
-- est fait. La sauvegarde prise par `scripts/update-pi.sh` reste le dernier
-- recours (voir docs/administration.md, « Retour arrière »).
--
-- ─────────────────────────────────────────────────────────────────────────────
-- CE QUE PRISMA PROPOSAIT EN PLUS, ET QUI A ÉTÉ RETIRÉ
-- ─────────────────────────────────────────────────────────────────────────────
--
-- · supprimer les quatre index GiST (parcel_geometries, pac_ilots,
--   pac_features, regulatory_zones) — créés en SQL brut, Prisma ne les
--   connaît pas. Sans eux, chaque carte repasse en parcours séquentiel ;
-- · supprimer la table de transit `stg_region_aura`, alimentée hors Prisma
--   par l'import des référentiels régionaux.

-- ---------------------------------------------------------------------------
-- Types
-- ---------------------------------------------------------------------------

DO $$ BEGIN
  CREATE TYPE "SupportTicketStatus" AS ENUM ('NEW', 'IN_PROGRESS', 'WAITING_CUSTOMER', 'RESOLVED', 'CLOSED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "SupportIdentity" AS ENUM ('ACCOUNT', 'EMAIL_CONFIRMED', 'UNVERIFIED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "SupportAuthorKind" AS ENUM ('REQUESTER', 'STAFF');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------------------------------------------------------------------------
-- Colonnes ajoutées aux tables existantes (toutes facultatives)
-- ---------------------------------------------------------------------------

ALTER TABLE "farms" ADD COLUMN IF NOT EXISTS "customer_number" TEXT;
ALTER TABLE "farms" ADD COLUMN IF NOT EXISTS "portfolio_id" TEXT;

ALTER TABLE "invitation_codes" ADD COLUMN IF NOT EXISTS "grants_secondary_admin" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "invitation_codes" ADD COLUMN IF NOT EXISTS "portfolio_id" TEXT;

ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "is_secondary_admin" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "portfolio_id" TEXT;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "technician_number" TEXT;

-- Un compte est administrateur général, secondaire, ou ni l'un ni l'autre.
-- Les deux à la fois brouilleraient le périmètre : lequel s'applique ?
ALTER TABLE "users" DROP CONSTRAINT IF EXISTS "users_un_seul_niveau_admin";
ALTER TABLE "users" ADD CONSTRAINT "users_un_seul_niveau_admin"
  CHECK (NOT ("is_platform_admin" AND "is_secondary_admin"));

-- ---------------------------------------------------------------------------
-- Tables nouvelles
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "customer_number_counters" (
    "prefix" TEXT NOT NULL,
    "last_value" BIGINT NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_number_counters_pkey" PRIMARY KEY ("prefix"),
    CONSTRAINT "customer_number_counters_positif" CHECK ("last_value" >= 0)
);

-- Les trois compteurs existent dès la migration : la fonction d'attribution
-- refuse un préfixe inconnu plutôt que d'en créer un à zéro, ce qui serait
-- une réinitialisation déguisée.
INSERT INTO "customer_number_counters" ("prefix", "last_value")
VALUES ('EXP', 0), ('TEC', 0), ('DEM', 0)
ON CONFLICT ("prefix") DO NOTHING;

CREATE TABLE IF NOT EXISTS "management_portfolios" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "created_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "management_portfolios_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "portfolio_managers" (
    "id" TEXT NOT NULL,
    "portfolio_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "granted_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "portfolio_managers_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "support_tickets" (
    "id" TEXT NOT NULL,
    "number" TEXT,
    "subject" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "area" TEXT,
    "status" "SupportTicketStatus" NOT NULL DEFAULT 'NEW',
    "requester_id" TEXT,
    "requester_name" TEXT NOT NULL,
    "requester_email" TEXT NOT NULL,
    "identity" "SupportIdentity" NOT NULL DEFAULT 'UNVERIFIED',
    "declared_number" TEXT,
    "farm_id" TEXT,
    "technician_id" TEXT,
    "portfolio_id" TEXT,
    "assignee_id" TEXT,
    "access_token_hash" TEXT,
    "access_token_expires_at" TIMESTAMP(3),
    "last_activity_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMP(3),
    "closed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "support_tickets_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "support_messages" (
    "id" TEXT NOT NULL,
    "ticket_id" TEXT NOT NULL,
    "author_id" TEXT,
    "author_kind" "SupportAuthorKind" NOT NULL,
    "body" TEXT NOT NULL,
    "internal" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "support_messages_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "support_ticket_events" (
    "id" TEXT NOT NULL,
    "ticket_id" TEXT NOT NULL,
    "actor_id" TEXT,
    "kind" TEXT NOT NULL,
    "from_value" TEXT,
    "to_value" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "support_ticket_events_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "support_attachments" (
    "id" TEXT NOT NULL,
    "ticket_id" TEXT NOT NULL,
    "message_id" TEXT,
    "file_name" TEXT NOT NULL,
    "storage_key" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "checksum" TEXT NOT NULL,
    "uploaded_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "support_attachments_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "faq_categories" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "faq_categories_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "faq_entries" (
    "id" TEXT NOT NULL,
    "category_id" TEXT NOT NULL,
    "slug" TEXT,
    "question" TEXT NOT NULL,
    "answer" TEXT NOT NULL,
    "keywords" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    "published" BOOLEAN NOT NULL DEFAULT true,
    "needs_review" BOOLEAN NOT NULL DEFAULT false,
    "updated_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "faq_entries_pkey" PRIMARY KEY ("id")
);

-- ---------------------------------------------------------------------------
-- Index et unicités
-- ---------------------------------------------------------------------------

CREATE UNIQUE INDEX IF NOT EXISTS "farms_customer_number_key" ON "farms"("customer_number");
CREATE INDEX IF NOT EXISTS "farms_portfolio_id_idx" ON "farms"("portfolio_id");
CREATE INDEX IF NOT EXISTS "invitation_codes_portfolio_id_idx" ON "invitation_codes"("portfolio_id");
CREATE UNIQUE INDEX IF NOT EXISTS "users_technician_number_key" ON "users"("technician_number");
CREATE INDEX IF NOT EXISTS "users_portfolio_id_idx" ON "users"("portfolio_id");

CREATE UNIQUE INDEX IF NOT EXISTS "management_portfolios_name_key" ON "management_portfolios"("name");
CREATE INDEX IF NOT EXISTS "portfolio_managers_user_id_idx" ON "portfolio_managers"("user_id");
CREATE UNIQUE INDEX IF NOT EXISTS "portfolio_managers_portfolio_id_user_id_key" ON "portfolio_managers"("portfolio_id", "user_id");

CREATE UNIQUE INDEX IF NOT EXISTS "support_tickets_number_key" ON "support_tickets"("number");
CREATE UNIQUE INDEX IF NOT EXISTS "support_tickets_access_token_hash_key" ON "support_tickets"("access_token_hash");
CREATE INDEX IF NOT EXISTS "support_tickets_portfolio_id_status_idx" ON "support_tickets"("portfolio_id", "status");
CREATE INDEX IF NOT EXISTS "support_tickets_assignee_id_status_idx" ON "support_tickets"("assignee_id", "status");
CREATE INDEX IF NOT EXISTS "support_tickets_requester_id_created_at_idx" ON "support_tickets"("requester_id", "created_at");
CREATE INDEX IF NOT EXISTS "support_tickets_status_last_activity_at_idx" ON "support_tickets"("status", "last_activity_at");
CREATE INDEX IF NOT EXISTS "support_tickets_farm_id_idx" ON "support_tickets"("farm_id");
CREATE INDEX IF NOT EXISTS "support_tickets_technician_id_idx" ON "support_tickets"("technician_id");
CREATE INDEX IF NOT EXISTS "support_messages_ticket_id_created_at_idx" ON "support_messages"("ticket_id", "created_at");
CREATE INDEX IF NOT EXISTS "support_ticket_events_ticket_id_created_at_idx" ON "support_ticket_events"("ticket_id", "created_at");
CREATE UNIQUE INDEX IF NOT EXISTS "support_attachments_storage_key_key" ON "support_attachments"("storage_key");
CREATE INDEX IF NOT EXISTS "support_attachments_ticket_id_idx" ON "support_attachments"("ticket_id");

CREATE UNIQUE INDEX IF NOT EXISTS "faq_categories_slug_key" ON "faq_categories"("slug");
CREATE UNIQUE INDEX IF NOT EXISTS "faq_entries_slug_key" ON "faq_entries"("slug");
CREATE INDEX IF NOT EXISTS "faq_entries_category_id_position_idx" ON "faq_entries"("category_id", "position");

-- ---------------------------------------------------------------------------
-- Clés étrangères (supprimées puis recréées : rejouable)
-- ---------------------------------------------------------------------------

ALTER TABLE "users" DROP CONSTRAINT IF EXISTS "users_portfolio_id_fkey";
ALTER TABLE "users" ADD CONSTRAINT "users_portfolio_id_fkey" FOREIGN KEY ("portfolio_id") REFERENCES "management_portfolios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "invitation_codes" DROP CONSTRAINT IF EXISTS "invitation_codes_portfolio_id_fkey";
ALTER TABLE "invitation_codes" ADD CONSTRAINT "invitation_codes_portfolio_id_fkey" FOREIGN KEY ("portfolio_id") REFERENCES "management_portfolios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "farms" DROP CONSTRAINT IF EXISTS "farms_portfolio_id_fkey";
ALTER TABLE "farms" ADD CONSTRAINT "farms_portfolio_id_fkey" FOREIGN KEY ("portfolio_id") REFERENCES "management_portfolios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "management_portfolios" DROP CONSTRAINT IF EXISTS "management_portfolios_created_by_id_fkey";
ALTER TABLE "management_portfolios" ADD CONSTRAINT "management_portfolios_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "portfolio_managers" DROP CONSTRAINT IF EXISTS "portfolio_managers_portfolio_id_fkey";
ALTER TABLE "portfolio_managers" ADD CONSTRAINT "portfolio_managers_portfolio_id_fkey" FOREIGN KEY ("portfolio_id") REFERENCES "management_portfolios"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "portfolio_managers" DROP CONSTRAINT IF EXISTS "portfolio_managers_user_id_fkey";
ALTER TABLE "portfolio_managers" ADD CONSTRAINT "portfolio_managers_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "portfolio_managers" DROP CONSTRAINT IF EXISTS "portfolio_managers_granted_by_id_fkey";
ALTER TABLE "portfolio_managers" ADD CONSTRAINT "portfolio_managers_granted_by_id_fkey" FOREIGN KEY ("granted_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "support_tickets" DROP CONSTRAINT IF EXISTS "support_tickets_requester_id_fkey";
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_requester_id_fkey" FOREIGN KEY ("requester_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "support_tickets" DROP CONSTRAINT IF EXISTS "support_tickets_farm_id_fkey";
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_farm_id_fkey" FOREIGN KEY ("farm_id") REFERENCES "farms"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "support_tickets" DROP CONSTRAINT IF EXISTS "support_tickets_technician_id_fkey";
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_technician_id_fkey" FOREIGN KEY ("technician_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "support_tickets" DROP CONSTRAINT IF EXISTS "support_tickets_portfolio_id_fkey";
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_portfolio_id_fkey" FOREIGN KEY ("portfolio_id") REFERENCES "management_portfolios"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "support_tickets" DROP CONSTRAINT IF EXISTS "support_tickets_assignee_id_fkey";
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_assignee_id_fkey" FOREIGN KEY ("assignee_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "support_messages" DROP CONSTRAINT IF EXISTS "support_messages_ticket_id_fkey";
ALTER TABLE "support_messages" ADD CONSTRAINT "support_messages_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "support_tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "support_messages" DROP CONSTRAINT IF EXISTS "support_messages_author_id_fkey";
ALTER TABLE "support_messages" ADD CONSTRAINT "support_messages_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "support_ticket_events" DROP CONSTRAINT IF EXISTS "support_ticket_events_ticket_id_fkey";
ALTER TABLE "support_ticket_events" ADD CONSTRAINT "support_ticket_events_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "support_tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "support_ticket_events" DROP CONSTRAINT IF EXISTS "support_ticket_events_actor_id_fkey";
ALTER TABLE "support_ticket_events" ADD CONSTRAINT "support_ticket_events_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "support_attachments" DROP CONSTRAINT IF EXISTS "support_attachments_ticket_id_fkey";
ALTER TABLE "support_attachments" ADD CONSTRAINT "support_attachments_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "support_tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "support_attachments" DROP CONSTRAINT IF EXISTS "support_attachments_message_id_fkey";
ALTER TABLE "support_attachments" ADD CONSTRAINT "support_attachments_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "support_messages"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "support_attachments" DROP CONSTRAINT IF EXISTS "support_attachments_uploaded_by_id_fkey";
ALTER TABLE "support_attachments" ADD CONSTRAINT "support_attachments_uploaded_by_id_fkey" FOREIGN KEY ("uploaded_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "faq_entries" DROP CONSTRAINT IF EXISTS "faq_entries_category_id_fkey";
ALTER TABLE "faq_entries" ADD CONSTRAINT "faq_entries_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "faq_categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "faq_entries" DROP CONSTRAINT IF EXISTS "faq_entries_updated_by_id_fkey";
ALTER TABLE "faq_entries" ADD CONSTRAINT "faq_entries_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Numéros publics : attribution par la base
-- ---------------------------------------------------------------------------
--
-- Pourquoi dans la base, et non dans le code
-- -------------------------------------------
-- Une exploitation se crée par l'inscription, par le jeu de démonstration, par
-- les scripts de vérification, par les tests. Attribuer le numéro dans le code
-- obligerait chacun de ces chemins à y penser — et le jour où l'un l'oublie,
-- une exploitation existe sans numéro, ou en reçoit un calculé de travers.
-- Un déclencheur ne s'oublie pas.
--
-- Pourquoi un compteur, et non `max(...) + 1`
-- -------------------------------------------
-- `max + 1` lu par deux transactions simultanées rend deux fois le même
-- numéro. L'`UPDATE … RETURNING` sur la ligne du compteur prend un verrou de
-- ligne tenu jusqu'à la fin de la transaction : la seconde attend la première
-- et reçoit le numéro suivant. L'index unique reste le dernier rempart.
--
-- Une transaction annulée rend son incrément (le compteur fait partie de la
-- transaction) : pas de trou pour une création qui échoue.

CREATE OR REPLACE FUNCTION parcelys_numero_suivant(p_prefixe TEXT) RETURNS TEXT
LANGUAGE plpgsql AS $$
DECLARE
  v_valeur BIGINT;
BEGIN
  UPDATE customer_number_counters
     SET last_value = last_value + 1,
         updated_at = CURRENT_TIMESTAMP
   WHERE prefix = p_prefixe
  RETURNING last_value INTO v_valeur;

  IF v_valeur IS NULL THEN
    -- Un préfixe inconnu n'est pas créé à la volée : ce serait repartir de 1.
    RAISE EXCEPTION 'Compteur de numéros « % » introuvable', p_prefixe
      USING ERRCODE = 'no_data_found';
  END IF;

  -- Six chiffres au minimum, sans jamais tronquer : `lpad` coupe une chaîne
  -- plus longue que la largeur demandée, d'où le `greatest`.
  RETURN p_prefixe || '-' || lpad(v_valeur::text, greatest(6, length(v_valeur::text)), '0');
END;
$$;

-- Un compteur ne redescend pas et ne disparaît pas : ce serait réattribuer
-- des numéros déjà donnés à des clients.
CREATE OR REPLACE FUNCTION parcelys_compteur_protege() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Le compteur de numéros « % » ne peut pas être supprimé', OLD.prefix
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF TG_OP = 'TRUNCATE' THEN
    RAISE EXCEPTION 'Les compteurs de numéros ne peuvent pas être vidés'
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.prefix IS DISTINCT FROM OLD.prefix OR NEW.last_value < OLD.last_value THEN
    RAISE EXCEPTION 'Le compteur « % » ne redescend jamais (% → %)', OLD.prefix, OLD.last_value, NEW.last_value
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS "customer_number_counters_protege" ON "customer_number_counters";
CREATE TRIGGER "customer_number_counters_protege"
  BEFORE UPDATE OR DELETE ON "customer_number_counters"
  FOR EACH ROW EXECUTE FUNCTION parcelys_compteur_protege();

DROP TRIGGER IF EXISTS "customer_number_counters_pas_de_vidage" ON "customer_number_counters";
CREATE TRIGGER "customer_number_counters_pas_de_vidage"
  BEFORE TRUNCATE ON "customer_number_counters"
  FOR EACH STATEMENT EXECUTE FUNCTION parcelys_compteur_protege();

-- Exploitations : `EXP-000001`.
--
-- À l'insertion, le numéro vient toujours du compteur — une valeur fournie est
-- ignorée. Une fois attribué, il ne change plus. Une ligne encore sans numéro
-- (antérieure à cette migration) en reçoit un à sa première mise à jour : c'est
-- ce que fait la reprise, plus bas.
CREATE OR REPLACE FUNCTION parcelys_numero_exploitation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.customer_number IS NOT NULL THEN
    IF NEW.customer_number IS DISTINCT FROM OLD.customer_number THEN
      RAISE EXCEPTION 'Le numéro client % est définitif', OLD.customer_number
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  NEW.customer_number := parcelys_numero_suivant('EXP');
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS "farms_numero_client" ON "farms";
CREATE TRIGGER "farms_numero_client"
  BEFORE INSERT OR UPDATE ON "farms"
  FOR EACH ROW EXECUTE FUNCTION parcelys_numero_exploitation();

-- Techniciens (comptes experts agronomiques) : `TEC-000001`.
--
-- Seul un compte `AGRONOMIST` en reçoit un. Un compte qui le deviendrait plus
-- tard le recevrait à ce moment-là ; un technicien qui cesserait de l'être
-- garde le sien — un numéro donné n'est jamais repris.
CREATE OR REPLACE FUNCTION parcelys_numero_technicien() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.technician_number IS NOT NULL THEN
    IF NEW.technician_number IS DISTINCT FROM OLD.technician_number THEN
      RAISE EXCEPTION 'Le numéro technicien % est définitif', OLD.technician_number
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  -- Jamais une valeur fournie : seul le compteur attribue.
  NEW.technician_number := NULL;
  IF NEW.account_type = 'AGRONOMIST' THEN
    NEW.technician_number := parcelys_numero_suivant('TEC');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS "users_numero_technicien" ON "users";
CREATE TRIGGER "users_numero_technicien"
  BEFORE INSERT OR UPDATE ON "users"
  FOR EACH ROW EXECUTE FUNCTION parcelys_numero_technicien();

-- Demandes de support : `DEM-000001`.
CREATE OR REPLACE FUNCTION parcelys_numero_demande() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.number IS NOT NULL THEN
    IF NEW.number IS DISTINCT FROM OLD.number THEN
      RAISE EXCEPTION 'Le numéro de demande % est définitif', OLD.number
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  NEW.number := parcelys_numero_suivant('DEM');
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS "support_tickets_numero" ON "support_tickets";
CREATE TRIGGER "support_tickets_numero"
  BEFORE INSERT OR UPDATE ON "support_tickets"
  FOR EACH ROW EXECUTE FUNCTION parcelys_numero_demande();

-- ---------------------------------------------------------------------------
-- Reprise : numéros des comptes et exploitations existants
-- ---------------------------------------------------------------------------
--
-- Idempotente : seules les lignes **sans** numéro en reçoivent un, dans
-- l'ordre de création (la plus ancienne exploitation est `EXP-000001`). Un
-- numéro existant n'est jamais touché — le déclencheur l'interdirait de toute
-- façon. Relancer la fonction après un incident termine le travail sans rien
-- refaire : c'est le mécanisme de reprise (`npm run numeros`).
--
-- Elle réaligne aussi le compteur sur le plus grand numéro présent, s'il
-- était en retard (numéros importés, déclencheur désactivé à la main) : le
-- prochain numéro attribué ne heurtera jamais un numéro existant. Le
-- réalignement ne fait que monter.
CREATE OR REPLACE FUNCTION parcelys_attribuer_numeros_manquants()
RETURNS TABLE (exploitations INTEGER, techniciens INTEGER)
LANGUAGE plpgsql AS $$
DECLARE
  v_ligne RECORD;
  v_exp INTEGER := 0;
  v_tec INTEGER := 0;
  v_max BIGINT;
BEGIN
  -- Réalignement d'abord, pour que les numéros attribués ensuite suivent.
  SELECT max(substring(customer_number FROM '^EXP-([0-9]+)$')::bigint) INTO v_max FROM farms;
  IF v_max IS NOT NULL THEN
    UPDATE customer_number_counters SET last_value = v_max, updated_at = CURRENT_TIMESTAMP
     WHERE prefix = 'EXP' AND last_value < v_max;
  END IF;
  SELECT max(substring(technician_number FROM '^TEC-([0-9]+)$')::bigint) INTO v_max FROM users;
  IF v_max IS NOT NULL THEN
    UPDATE customer_number_counters SET last_value = v_max, updated_at = CURRENT_TIMESTAMP
     WHERE prefix = 'TEC' AND last_value < v_max;
  END IF;
  SELECT max(substring(number FROM '^DEM-([0-9]+)$')::bigint) INTO v_max FROM support_tickets;
  IF v_max IS NOT NULL THEN
    UPDATE customer_number_counters SET last_value = v_max, updated_at = CURRENT_TIMESTAMP
     WHERE prefix = 'DEM' AND last_value < v_max;
  END IF;

  -- La mise à jour « à vide » déclenche l'attribution (voir
  -- `parcelys_numero_exploitation`) : le numéro vient du compteur, et de lui
  -- seul.
  FOR v_ligne IN
    SELECT id FROM farms WHERE customer_number IS NULL ORDER BY created_at, id FOR UPDATE
  LOOP
    UPDATE farms SET customer_number = NULL WHERE id = v_ligne.id AND customer_number IS NULL;
    v_exp := v_exp + 1;
  END LOOP;

  FOR v_ligne IN
    SELECT id FROM users
     WHERE technician_number IS NULL AND account_type = 'AGRONOMIST'
     ORDER BY created_at, id FOR UPDATE
  LOOP
    UPDATE users SET technician_number = NULL WHERE id = v_ligne.id AND technician_number IS NULL;
    v_tec := v_tec + 1;
  END LOOP;

  RETURN QUERY SELECT v_exp, v_tec;
END;
$$;

SELECT * FROM parcelys_attribuer_numeros_manquants();
