-- CreateTable
CREATE TABLE "bank_statements" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "number" VARCHAR(30) NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'draft',
    "statement_date" DATE NOT NULL,
    "opening_balance" DECIMAL(19,4) NOT NULL,
    "closing_balance" DECIMAL(19,4) NOT NULL,
    "notes" TEXT,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "bank_statements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bank_statement_lines" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "bank_statement_id" UUID NOT NULL,
    "line_no" INTEGER NOT NULL,
    "value_date" DATE NOT NULL,
    "description" VARCHAR(400) NOT NULL,
    "reference" VARCHAR(120),
    "amount" DECIMAL(19,4) NOT NULL,
    "reconciled_entry_id" UUID,
    "reconciled_at" TIMESTAMPTZ,
    "reconciled_by" UUID,

    CONSTRAINT "bank_statement_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "expense_bills" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "supplier_id" UUID,
    "number" VARCHAR(30) NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'draft',
    "bill_date" DATE NOT NULL,
    "due_date" DATE,
    "subtotal" DECIMAL(19,4) NOT NULL,
    "tax_total" DECIMAL(19,4) NOT NULL,
    "total" DECIMAL(19,4) NOT NULL,
    "paid_total" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "outstanding" DECIMAL(19,4) NOT NULL,
    "pay_from" VARCHAR(20) NOT NULL,
    "bank_account_id" UUID,
    "currency" VARCHAR(3) NOT NULL,
    "notes" TEXT,
    "requested_by" UUID,
    "approved_by" UUID,
    "approved_at" TIMESTAMPTZ,
    "journal_entry_id" UUID,
    "idempotency_key" VARCHAR(100),
    "created_by" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "expense_bills_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "expense_bill_lines" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "expense_bill_id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "description" VARCHAR(400) NOT NULL,
    "quantity" DECIMAL(19,4) NOT NULL,
    "unit_price" DECIMAL(19,4) NOT NULL,
    "tax_rate" DECIMAL(9,4) NOT NULL,
    "line_total" DECIMAL(19,4) NOT NULL,
    "tax_amount" DECIMAL(19,4) NOT NULL,

    CONSTRAINT "expense_bill_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "bank_statements_company_id_status_idx" ON "bank_statements"("company_id", "status");

-- CreateIndex
CREATE INDEX "bank_statements_account_id_idx" ON "bank_statements"("account_id");

-- CreateIndex
CREATE UNIQUE INDEX "bank_statements_company_id_number_key" ON "bank_statements"("company_id", "number");

-- CreateIndex
CREATE INDEX "bank_statement_lines_bank_statement_id_idx" ON "bank_statement_lines"("bank_statement_id");

-- CreateIndex
CREATE INDEX "bank_statement_lines_reconciled_entry_id_idx" ON "bank_statement_lines"("reconciled_entry_id");

-- CreateIndex
CREATE UNIQUE INDEX "expense_bills_idempotency_key_key" ON "expense_bills"("idempotency_key");

-- CreateIndex
CREATE INDEX "expense_bills_company_id_status_idx" ON "expense_bills"("company_id", "status");

-- CreateIndex
CREATE INDEX "expense_bills_supplier_id_idx" ON "expense_bills"("supplier_id");

-- CreateIndex
CREATE UNIQUE INDEX "expense_bills_company_id_number_key" ON "expense_bills"("company_id", "number");

-- CreateIndex
CREATE INDEX "expense_bill_lines_expense_bill_id_idx" ON "expense_bill_lines"("expense_bill_id");

-- AddForeignKey
ALTER TABLE "bank_statements" ADD CONSTRAINT "bank_statements_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_statements" ADD CONSTRAINT "bank_statements_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_statements" ADD CONSTRAINT "bank_statements_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_statements" ADD CONSTRAINT "bank_statements_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_statement_lines" ADD CONSTRAINT "bank_statement_lines_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_statement_lines" ADD CONSTRAINT "bank_statement_lines_bank_statement_id_fkey" FOREIGN KEY ("bank_statement_id") REFERENCES "bank_statements"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_statement_lines" ADD CONSTRAINT "bank_statement_lines_reconciled_entry_id_fkey" FOREIGN KEY ("reconciled_entry_id") REFERENCES "journal_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_statement_lines" ADD CONSTRAINT "bank_statement_lines_reconciled_by_fkey" FOREIGN KEY ("reconciled_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense_bills" ADD CONSTRAINT "expense_bills_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense_bills" ADD CONSTRAINT "expense_bills_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense_bills" ADD CONSTRAINT "expense_bills_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense_bills" ADD CONSTRAINT "expense_bills_bank_account_id_fkey" FOREIGN KEY ("bank_account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense_bills" ADD CONSTRAINT "expense_bills_journal_entry_id_fkey" FOREIGN KEY ("journal_entry_id") REFERENCES "journal_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense_bills" ADD CONSTRAINT "expense_bills_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense_bill_lines" ADD CONSTRAINT "expense_bill_lines_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense_bill_lines" ADD CONSTRAINT "expense_bill_lines_expense_bill_id_fkey" FOREIGN KEY ("expense_bill_id") REFERENCES "expense_bills"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense_bill_lines" ADD CONSTRAINT "expense_bill_lines_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
