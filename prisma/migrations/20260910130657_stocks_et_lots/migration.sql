-- Stocks et lots.
--
-- Note pour la prochaine migration : Prisma a de nouveau proposé de supprimer
-- les quatre index GiST (pac_features, pac_ilots, parcel_geometries,
-- regulatory_zones). Il ne peut pas les connaître — ils portent sur des
-- colonnes `Unsupported("geometry(...)")`, créées en SQL brut. Ces DROP ont
-- été retirés à la main, comme à chaque fois. `tests/migrations.test.ts` le
-- vérifie.

-- CreateEnum
CREATE TYPE "StockCategory" AS ENUM ('PHYTOSANITAIRE', 'ENGRAIS', 'AMENDEMENT', 'SEMENCE', 'AUTRE');

-- CreateEnum
CREATE TYPE "StockMovementKind" AS ENUM ('ENTREE', 'SORTIE', 'AJUSTEMENT', 'RETOUR', 'DESTRUCTION');

-- CreateTable
CREATE TABLE "stock_items" (
    "id" TEXT NOT NULL,
    "farm_id" TEXT NOT NULL,
    "category" "StockCategory" NOT NULL,
    "name" TEXT NOT NULL,
    "phyto_product_id" TEXT,
    "fertilizer_id" TEXT,
    "organic_input_id" TEXT,
    "unit" TEXT NOT NULL,
    "alert_threshold" DECIMAL(14,3),
    "notes" TEXT,
    "archived_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stock_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_lots" (
    "id" TEXT NOT NULL,
    "item_id" TEXT NOT NULL,
    "lot_number" TEXT,
    "supplier" TEXT,
    "purchased_on" TIMESTAMP(3),
    "expires_on" TIMESTAMP(3),
    "unit_price" DECIMAL(12,4),
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "document_id" TEXT,
    "notes" TEXT,
    "closed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stock_lots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_movements" (
    "id" TEXT NOT NULL,
    "item_id" TEXT NOT NULL,
    "lot_id" TEXT,
    "kind" "StockMovementKind" NOT NULL,
    "occurred_on" TIMESTAMP(3) NOT NULL,
    "quantity" DECIMAL(14,3) NOT NULL,
    "unit" TEXT NOT NULL,
    "phyto_application_id" TEXT,
    "fertilizer_application_id" TEXT,
    "operation_id" TEXT,
    "reason" TEXT,
    "created_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_movements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "stock_items_farm_id_category_idx" ON "stock_items"("farm_id", "category");

-- CreateIndex
CREATE UNIQUE INDEX "stock_items_farm_id_category_name_key" ON "stock_items"("farm_id", "category", "name");

-- CreateIndex
CREATE INDEX "stock_lots_item_id_idx" ON "stock_lots"("item_id");

-- CreateIndex
CREATE INDEX "stock_lots_expires_on_idx" ON "stock_lots"("expires_on");

-- CreateIndex
CREATE INDEX "stock_movements_item_id_occurred_on_idx" ON "stock_movements"("item_id", "occurred_on");

-- CreateIndex
CREATE INDEX "stock_movements_lot_id_idx" ON "stock_movements"("lot_id");

-- CreateIndex
CREATE INDEX "stock_movements_phyto_application_id_idx" ON "stock_movements"("phyto_application_id");

-- CreateIndex
CREATE INDEX "stock_movements_fertilizer_application_id_idx" ON "stock_movements"("fertilizer_application_id");

-- AddForeignKey
ALTER TABLE "stock_items" ADD CONSTRAINT "stock_items_farm_id_fkey" FOREIGN KEY ("farm_id") REFERENCES "farms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_items" ADD CONSTRAINT "stock_items_phyto_product_id_fkey" FOREIGN KEY ("phyto_product_id") REFERENCES "phytosanitary_products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_items" ADD CONSTRAINT "stock_items_fertilizer_id_fkey" FOREIGN KEY ("fertilizer_id") REFERENCES "fertilizers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_items" ADD CONSTRAINT "stock_items_organic_input_id_fkey" FOREIGN KEY ("organic_input_id") REFERENCES "organic_inputs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_lots" ADD CONSTRAINT "stock_lots_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "stock_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_lots" ADD CONSTRAINT "stock_lots_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "stock_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_lot_id_fkey" FOREIGN KEY ("lot_id") REFERENCES "stock_lots"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_phyto_application_id_fkey" FOREIGN KEY ("phyto_application_id") REFERENCES "phytosanitary_applications"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_fertilizer_application_id_fkey" FOREIGN KEY ("fertilizer_application_id") REFERENCES "fertilizer_applications"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_operation_id_fkey" FOREIGN KEY ("operation_id") REFERENCES "agricultural_operations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

