-- AlterTable
ALTER TABLE "bank_statements" ADD COLUMN     "idempotency_key" VARCHAR(100);

-- CreateIndex
CREATE UNIQUE INDEX "bank_statements_idempotency_key_key" ON "bank_statements"("idempotency_key");

