-- Mentions de danger des produits phytopharmaceutiques (H…, EUH…), importées
-- du fichier E-Phy « produits_phrases_de_risque ». Elles commandent, avec
-- l'autorisation, les distances de sécurité aux abords des habitations.
CREATE TABLE "phyto_hazard_statements" (
    "id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT,

    CONSTRAINT "phyto_hazard_statements_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "phyto_hazard_statements_product_id_idx" ON "phyto_hazard_statements"("product_id");

ALTER TABLE "phyto_hazard_statements" ADD CONSTRAINT "phyto_hazard_statements_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "phytosanitary_products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
