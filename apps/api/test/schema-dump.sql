--
-- PostgreSQL database dump
--

-- Dumped from database version 16.2
-- Dumped by pg_dump version 16.2

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: public; Type: SCHEMA; Schema: -; Owner: -
--

-- *not* creating schema, since initdb creates it


--
-- Name: SCHEMA public; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON SCHEMA public IS '';


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: _prisma_migrations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public._prisma_migrations (
    id character varying(36) NOT NULL,
    checksum character varying(64) NOT NULL,
    finished_at timestamp with time zone,
    migration_name character varying(255) NOT NULL,
    logs text,
    rolled_back_at timestamp with time zone,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    applied_steps_count integer DEFAULT 0 NOT NULL
);


--
-- Name: account_types; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.account_types (
    id uuid NOT NULL,
    code character varying(20) NOT NULL,
    name_ar character varying(80) NOT NULL,
    name_en character varying(80) NOT NULL
);


--
-- Name: accounting_periods; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.accounting_periods (
    id uuid NOT NULL,
    fiscal_year_id uuid NOT NULL,
    company_id uuid NOT NULL,
    name character varying(80) NOT NULL,
    start_date date NOT NULL,
    end_date date NOT NULL,
    status character varying(20) DEFAULT 'open'::character varying NOT NULL,
    closed_by uuid,
    closed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone NOT NULL
);


--
-- Name: accounts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.accounts (
    id uuid NOT NULL,
    company_id uuid NOT NULL,
    code character varying(30) NOT NULL,
    name_ar character varying(160) NOT NULL,
    name_en character varying(160) NOT NULL,
    account_type_id uuid NOT NULL,
    parent_id uuid,
    is_postable boolean DEFAULT true NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    description text,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    created_by uuid
);


--
-- Name: addresses; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.addresses (
    id uuid NOT NULL,
    owner_type character varying(20) NOT NULL,
    owner_id uuid NOT NULL,
    label character varying(80),
    line1 character varying(255) NOT NULL,
    line2 character varying(255),
    city character varying(120),
    country character varying(120),
    is_billing boolean DEFAULT false NOT NULL,
    is_shipping boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone NOT NULL
);


--
-- Name: attachments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.attachments (
    id uuid NOT NULL,
    owner_type character varying(40) NOT NULL,
    owner_id uuid NOT NULL,
    file_key character varying(255) NOT NULL,
    file_name character varying(255) NOT NULL,
    mime character varying(120) NOT NULL,
    size integer NOT NULL,
    uploaded_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: audit_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.audit_events (
    id uuid NOT NULL,
    organization_id uuid,
    actor_id uuid,
    action character varying(120) NOT NULL,
    entity_type character varying(80),
    entity_id character varying(80),
    diff jsonb,
    ip character varying(60),
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: bank_statement_lines; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bank_statement_lines (
    id uuid NOT NULL,
    organization_id uuid NOT NULL,
    bank_statement_id uuid NOT NULL,
    line_no integer NOT NULL,
    value_date date NOT NULL,
    description character varying(400) NOT NULL,
    reference character varying(120),
    amount numeric(19,4) NOT NULL,
    reconciled_entry_id uuid,
    reconciled_at timestamp with time zone,
    reconciled_by uuid
);


--
-- Name: bank_statements; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bank_statements (
    id uuid NOT NULL,
    organization_id uuid NOT NULL,
    company_id uuid NOT NULL,
    account_id uuid NOT NULL,
    number character varying(30) NOT NULL,
    status character varying(20) DEFAULT 'draft'::character varying NOT NULL,
    statement_date date NOT NULL,
    opening_balance numeric(19,4) NOT NULL,
    closing_balance numeric(19,4) NOT NULL,
    notes text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    idempotency_key character varying(100)
);


--
-- Name: branches; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.branches (
    id uuid NOT NULL,
    company_id uuid NOT NULL,
    name character varying(120) NOT NULL,
    name_ar character varying(120) NOT NULL,
    status character varying(20) DEFAULT 'active'::character varying NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone NOT NULL
);


--
-- Name: companies; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.companies (
    id uuid NOT NULL,
    organization_id uuid NOT NULL,
    name character varying(120) NOT NULL,
    name_ar character varying(120) NOT NULL,
    base_currency character varying(3) NOT NULL,
    tax_id character varying(60),
    status character varying(20) DEFAULT 'active'::character varying NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    maker_checker_journal boolean DEFAULT false NOT NULL
);


--
-- Name: contacts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.contacts (
    id uuid NOT NULL,
    owner_type character varying(20) NOT NULL,
    owner_id uuid NOT NULL,
    name character varying(160) NOT NULL,
    role character varying(120),
    phone character varying(40),
    email character varying(255),
    is_primary boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone NOT NULL
);


--
-- Name: credit_note_lines; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.credit_note_lines (
    id uuid NOT NULL,
    credit_note_id uuid NOT NULL,
    sales_invoice_line_id uuid,
    product_id uuid,
    description character varying(255) NOT NULL,
    quantity numeric(19,4) NOT NULL,
    unit_price numeric(19,4) NOT NULL,
    discount_rate numeric(8,4) DEFAULT 0 NOT NULL,
    tax_rate numeric(8,4) DEFAULT 0 NOT NULL,
    line_total numeric(19,4) NOT NULL
);


--
-- Name: credit_notes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.credit_notes (
    id uuid NOT NULL,
    organization_id uuid NOT NULL,
    company_id uuid NOT NULL,
    customer_id uuid NOT NULL,
    sales_invoice_id uuid,
    number character varying(30) NOT NULL,
    status character varying(20) DEFAULT 'draft'::character varying NOT NULL,
    credit_date date NOT NULL,
    subtotal numeric(19,4) NOT NULL,
    tax_total numeric(19,4) NOT NULL,
    total numeric(19,4) NOT NULL,
    currency character varying(3) NOT NULL,
    reason character varying(255) NOT NULL,
    is_return boolean DEFAULT false NOT NULL,
    journal_entry_id uuid,
    idempotency_key character varying(100),
    created_by uuid,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone NOT NULL
);


--
-- Name: currencies; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.currencies (
    code character varying(3) NOT NULL,
    name_ar character varying(80) NOT NULL,
    name_en character varying(80) NOT NULL,
    decimals integer DEFAULT 2 NOT NULL
);


--
-- Name: customers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.customers (
    id uuid NOT NULL,
    company_id uuid NOT NULL,
    number character varying(30) NOT NULL,
    name_ar character varying(160) NOT NULL,
    name_en character varying(160) NOT NULL,
    kind character varying(20) DEFAULT 'company'::character varying NOT NULL,
    tax_id character varying(60),
    payment_term_id uuid,
    credit_limit numeric(19,4),
    status character varying(20) DEFAULT 'active'::character varying NOT NULL,
    salesperson_id uuid,
    created_by uuid,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone NOT NULL
);


--
-- Name: deliveries; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.deliveries (
    id uuid NOT NULL,
    organization_id uuid NOT NULL,
    company_id uuid NOT NULL,
    sales_order_id uuid NOT NULL,
    warehouse_id uuid NOT NULL,
    number character varying(30) NOT NULL,
    status character varying(30) DEFAULT 'draft'::character varying NOT NULL,
    delivery_date date NOT NULL,
    notes text,
    idempotency_key character varying(100),
    created_by uuid,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone NOT NULL
);


--
-- Name: delivery_lines; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.delivery_lines (
    id uuid NOT NULL,
    delivery_id uuid NOT NULL,
    sales_order_line_id uuid NOT NULL,
    product_id uuid NOT NULL,
    quantity numeric(19,4) NOT NULL
);


--
-- Name: document_sequences; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.document_sequences (
    id uuid NOT NULL,
    company_id uuid NOT NULL,
    document_type character varying(60) NOT NULL,
    prefix character varying(20) NOT NULL,
    next_number integer DEFAULT 1 NOT NULL,
    last_reset_year integer,
    reset_policy character varying(10) DEFAULT 'never'::character varying NOT NULL
);


--
-- Name: expense_bill_lines; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.expense_bill_lines (
    id uuid NOT NULL,
    organization_id uuid NOT NULL,
    expense_bill_id uuid NOT NULL,
    account_id uuid NOT NULL,
    description character varying(400) NOT NULL,
    quantity numeric(19,4) NOT NULL,
    unit_price numeric(19,4) NOT NULL,
    tax_rate numeric(9,4) NOT NULL,
    line_total numeric(19,4) NOT NULL,
    tax_amount numeric(19,4) NOT NULL
);


--
-- Name: expense_bills; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.expense_bills (
    id uuid NOT NULL,
    organization_id uuid NOT NULL,
    company_id uuid NOT NULL,
    supplier_id uuid,
    number character varying(30) NOT NULL,
    status character varying(20) DEFAULT 'draft'::character varying NOT NULL,
    bill_date date NOT NULL,
    due_date date,
    subtotal numeric(19,4) NOT NULL,
    tax_total numeric(19,4) NOT NULL,
    total numeric(19,4) NOT NULL,
    paid_total numeric(19,4) DEFAULT 0 NOT NULL,
    outstanding numeric(19,4) NOT NULL,
    pay_from character varying(20) NOT NULL,
    bank_account_id uuid,
    currency character varying(3) NOT NULL,
    notes text,
    requested_by uuid,
    approved_by uuid,
    approved_at timestamp with time zone,
    journal_entry_id uuid,
    idempotency_key character varying(100),
    created_by uuid,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone NOT NULL
);


--
-- Name: fiscal_years; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.fiscal_years (
    id uuid NOT NULL,
    company_id uuid NOT NULL,
    name character varying(80) NOT NULL,
    start_date date NOT NULL,
    end_date date NOT NULL,
    status character varying(20) DEFAULT 'open'::character varying NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone NOT NULL
);


--
-- Name: goods_receipt_lines; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.goods_receipt_lines (
    id uuid NOT NULL,
    goods_receipt_id uuid NOT NULL,
    purchase_order_line_id uuid NOT NULL,
    product_id uuid NOT NULL,
    quantity numeric(19,4) NOT NULL,
    unit_cost numeric(19,4) NOT NULL
);


--
-- Name: goods_receipts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.goods_receipts (
    id uuid NOT NULL,
    organization_id uuid NOT NULL,
    company_id uuid NOT NULL,
    purchase_order_id uuid NOT NULL,
    warehouse_id uuid NOT NULL,
    number character varying(30) NOT NULL,
    status character varying(20) DEFAULT 'draft'::character varying NOT NULL,
    receipt_date date NOT NULL,
    notes text,
    idempotency_key character varying(100),
    created_by uuid,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone NOT NULL
);


--
-- Name: idempotency_keys; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.idempotency_keys (
    key character varying(100) NOT NULL,
    user_id uuid NOT NULL,
    status integer NOT NULL,
    body jsonb NOT NULL,
    expires_at timestamp with time zone NOT NULL
);


--
-- Name: inventory_adjustment_lines; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.inventory_adjustment_lines (
    id uuid NOT NULL,
    adjustment_id uuid NOT NULL,
    product_id uuid NOT NULL,
    quantity_delta numeric(19,4) NOT NULL,
    unit_cost numeric(19,4)
);


--
-- Name: inventory_adjustments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.inventory_adjustments (
    id uuid NOT NULL,
    organization_id uuid NOT NULL,
    company_id uuid NOT NULL,
    warehouse_id uuid NOT NULL,
    number character varying(40) NOT NULL,
    status character varying(20) DEFAULT 'draft'::character varying NOT NULL,
    reason character varying(500),
    idempotency_key character varying(100),
    created_by uuid,
    approved_by uuid,
    posted_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone NOT NULL
);


--
-- Name: inventory_count_lines; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.inventory_count_lines (
    id uuid NOT NULL,
    count_id uuid NOT NULL,
    product_id uuid NOT NULL,
    system_qty numeric(19,4) NOT NULL,
    counted_qty numeric(19,4) NOT NULL
);


--
-- Name: inventory_counts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.inventory_counts (
    id uuid NOT NULL,
    organization_id uuid NOT NULL,
    company_id uuid NOT NULL,
    warehouse_id uuid NOT NULL,
    number character varying(40) NOT NULL,
    status character varying(20) DEFAULT 'draft'::character varying NOT NULL,
    idempotency_key character varying(100),
    created_by uuid,
    posted_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone NOT NULL
);


--
-- Name: inventory_transfer_lines; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.inventory_transfer_lines (
    id uuid NOT NULL,
    transfer_id uuid NOT NULL,
    product_id uuid NOT NULL,
    quantity numeric(19,4) NOT NULL
);


--
-- Name: inventory_transfers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.inventory_transfers (
    id uuid NOT NULL,
    organization_id uuid NOT NULL,
    company_id uuid NOT NULL,
    from_warehouse_id uuid NOT NULL,
    to_warehouse_id uuid NOT NULL,
    number character varying(40) NOT NULL,
    status character varying(20) DEFAULT 'draft'::character varying NOT NULL,
    idempotency_key character varying(100),
    created_by uuid,
    dispatched_at timestamp with time zone,
    received_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone NOT NULL
);


--
-- Name: inventory_valuation_entries; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.inventory_valuation_entries (
    id uuid NOT NULL,
    organization_id uuid NOT NULL,
    company_id uuid NOT NULL,
    warehouse_id uuid NOT NULL,
    product_id uuid NOT NULL,
    movement_id uuid NOT NULL,
    quantity_delta numeric(19,4) NOT NULL,
    cost_delta numeric(19,4) NOT NULL,
    resulting_qty numeric(19,4) NOT NULL,
    resulting_avg_cost numeric(19,4) NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: invitations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.invitations (
    id uuid NOT NULL,
    organization_id uuid NOT NULL,
    email character varying(255) NOT NULL,
    token_hash text NOT NULL,
    role_ids jsonb NOT NULL,
    company_ids jsonb DEFAULT '[]'::jsonb NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    accepted_at timestamp with time zone,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: journal_entries; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.journal_entries (
    id uuid NOT NULL,
    company_id uuid NOT NULL,
    period_id uuid,
    journal_type character varying(30) NOT NULL,
    posting_date date NOT NULL,
    currency character varying(3) NOT NULL,
    exchange_rate numeric(19,6) NOT NULL,
    description text NOT NULL,
    source_type character varying(60),
    source_id uuid,
    status character varying(20) DEFAULT 'draft'::character varying NOT NULL,
    idempotency_key character varying(100),
    reversal_of_id uuid,
    posted_by uuid,
    posted_at timestamp with time zone,
    version integer DEFAULT 1 NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    created_by uuid
);


--
-- Name: journal_lines; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.journal_lines (
    id uuid NOT NULL,
    journal_entry_id uuid NOT NULL,
    account_id uuid NOT NULL,
    debit numeric(19,4) NOT NULL,
    credit numeric(19,4) NOT NULL,
    description text,
    cost_center character varying(80),
    tax_code_id uuid,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT journal_lines_amounts_check CHECK (((debit >= (0)::numeric) AND (credit >= (0)::numeric) AND ((debit > (0)::numeric) OR (credit > (0)::numeric))))
);


--
-- Name: membership_branches; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.membership_branches (
    membership_id uuid NOT NULL,
    branch_id uuid NOT NULL
);


--
-- Name: membership_companies; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.membership_companies (
    membership_id uuid NOT NULL,
    company_id uuid NOT NULL
);


--
-- Name: memberships; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.memberships (
    id uuid NOT NULL,
    user_id uuid NOT NULL,
    organization_id uuid NOT NULL,
    status character varying(20) DEFAULT 'active'::character varying NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: notifications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notifications (
    id uuid NOT NULL,
    organization_id uuid NOT NULL,
    user_id uuid NOT NULL,
    type character varying(60) NOT NULL,
    title_ar character varying(300) NOT NULL,
    title_en character varying(300) NOT NULL,
    body_ar text,
    body_en text,
    link character varying(500),
    read_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: organizations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.organizations (
    id uuid NOT NULL,
    name character varying(120) NOT NULL,
    name_ar character varying(120) NOT NULL,
    default_currency character varying(3) NOT NULL,
    default_timezone character varying(60) NOT NULL,
    status character varying(20) DEFAULT 'active'::character varying NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone NOT NULL
);


--
-- Name: password_reset_tokens; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.password_reset_tokens (
    id uuid NOT NULL,
    user_id uuid NOT NULL,
    token_hash text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    used_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: payment_allocations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.payment_allocations (
    id uuid NOT NULL,
    organization_id uuid NOT NULL,
    sales_payment_id uuid NOT NULL,
    sales_invoice_id uuid NOT NULL,
    amount numeric(19,4) NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: payment_terms; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.payment_terms (
    id uuid NOT NULL,
    company_id uuid NOT NULL,
    name_ar character varying(120) NOT NULL,
    name_en character varying(120) NOT NULL,
    days integer NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone NOT NULL
);


--
-- Name: permissions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.permissions (
    id uuid NOT NULL,
    resource character varying(60) NOT NULL,
    action character varying(40) NOT NULL
);


--
-- Name: product_categories; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.product_categories (
    id uuid NOT NULL,
    company_id uuid NOT NULL,
    name_ar character varying(160) NOT NULL,
    name_en character varying(160) NOT NULL,
    parent_id uuid,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone NOT NULL
);


--
-- Name: product_variants; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.product_variants (
    id uuid NOT NULL,
    company_id uuid NOT NULL,
    product_id uuid NOT NULL,
    sku character varying(60) NOT NULL,
    attributes jsonb DEFAULT '{}'::jsonb NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone NOT NULL
);


--
-- Name: products; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.products (
    id uuid NOT NULL,
    company_id uuid NOT NULL,
    sku character varying(60) NOT NULL,
    name_ar character varying(200) NOT NULL,
    name_en character varying(200) NOT NULL,
    type character varying(20) DEFAULT 'stocked'::character varying NOT NULL,
    category_id uuid,
    base_uom_id uuid NOT NULL,
    purchase_price numeric(19,4),
    sales_price numeric(19,4),
    tax_code_id uuid,
    reorder_level numeric(19,4),
    preferred_supplier_id uuid,
    inventory_account_id uuid,
    cogs_account_id uuid,
    revenue_account_id uuid,
    is_active boolean DEFAULT true NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone NOT NULL
);


--
-- Name: purchase_order_lines; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.purchase_order_lines (
    id uuid NOT NULL,
    purchase_order_id uuid NOT NULL,
    product_id uuid NOT NULL,
    description character varying(255) NOT NULL,
    quantity numeric(19,4) NOT NULL,
    unit_price numeric(19,4) NOT NULL,
    discount_rate numeric(8,4) DEFAULT 0 NOT NULL,
    tax_rate numeric(8,4) DEFAULT 0 NOT NULL,
    line_total numeric(19,4) NOT NULL,
    received_quantity numeric(19,4) DEFAULT 0 NOT NULL,
    billed_quantity numeric(19,4) DEFAULT 0 NOT NULL
);


--
-- Name: purchase_orders; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.purchase_orders (
    id uuid NOT NULL,
    organization_id uuid NOT NULL,
    company_id uuid NOT NULL,
    supplier_id uuid NOT NULL,
    purchase_request_id uuid,
    rfq_id uuid,
    warehouse_id uuid NOT NULL,
    number character varying(30) NOT NULL,
    status character varying(20) DEFAULT 'draft'::character varying NOT NULL,
    requested_by uuid,
    approved_by uuid,
    approved_at timestamp with time zone,
    subtotal numeric(19,4) NOT NULL,
    tax_total numeric(19,4) NOT NULL,
    total numeric(19,4) NOT NULL,
    currency character varying(3) NOT NULL,
    notes text,
    idempotency_key character varying(100),
    created_by uuid,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone NOT NULL
);


--
-- Name: purchase_request_lines; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.purchase_request_lines (
    id uuid NOT NULL,
    purchase_request_id uuid NOT NULL,
    product_id uuid,
    description character varying(255) NOT NULL,
    quantity numeric(19,4) NOT NULL,
    unit_price numeric(19,4) NOT NULL,
    line_total numeric(19,4) NOT NULL
);


--
-- Name: purchase_requests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.purchase_requests (
    id uuid NOT NULL,
    organization_id uuid NOT NULL,
    company_id uuid NOT NULL,
    number character varying(30) NOT NULL,
    status character varying(20) DEFAULT 'draft'::character varying NOT NULL,
    requested_by uuid,
    approved_by uuid,
    approved_at timestamp with time zone,
    subtotal numeric(19,4) NOT NULL,
    total numeric(19,4) NOT NULL,
    currency character varying(3) NOT NULL,
    notes text,
    idempotency_key character varying(100),
    created_by uuid,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone NOT NULL
);


--
-- Name: quotation_lines; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.quotation_lines (
    id uuid NOT NULL,
    quotation_id uuid NOT NULL,
    product_id uuid,
    description character varying(255) NOT NULL,
    quantity numeric(19,4) NOT NULL,
    unit_price numeric(19,4) NOT NULL,
    discount_rate numeric(8,4) DEFAULT 0 NOT NULL,
    tax_rate numeric(8,4) DEFAULT 0 NOT NULL,
    line_total numeric(19,4) NOT NULL
);


--
-- Name: quotations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.quotations (
    id uuid NOT NULL,
    organization_id uuid NOT NULL,
    company_id uuid NOT NULL,
    customer_id uuid NOT NULL,
    number character varying(30) NOT NULL,
    status character varying(20) DEFAULT 'draft'::character varying NOT NULL,
    valid_until date NOT NULL,
    subtotal numeric(19,4) NOT NULL,
    tax_total numeric(19,4) NOT NULL,
    total numeric(19,4) NOT NULL,
    currency character varying(3) NOT NULL,
    notes text,
    idempotency_key character varying(100),
    created_by uuid,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone NOT NULL
);


--
-- Name: rfq_lines; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.rfq_lines (
    id uuid NOT NULL,
    rfq_id uuid NOT NULL,
    supplier_id uuid NOT NULL,
    product_id uuid,
    description character varying(255) NOT NULL,
    quantity numeric(19,4) NOT NULL,
    quoted_price numeric(19,4),
    awarded boolean DEFAULT false NOT NULL
);


--
-- Name: rfqs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.rfqs (
    id uuid NOT NULL,
    organization_id uuid NOT NULL,
    company_id uuid NOT NULL,
    number character varying(30) NOT NULL,
    status character varying(20) DEFAULT 'draft'::character varying NOT NULL,
    supplier_id uuid,
    purchase_request_id uuid,
    subtotal numeric(19,4) NOT NULL,
    total numeric(19,4) NOT NULL,
    currency character varying(3) NOT NULL,
    notes text,
    idempotency_key character varying(100),
    created_by uuid,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone NOT NULL
);


--
-- Name: role_permissions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.role_permissions (
    role_id uuid NOT NULL,
    permission_id uuid NOT NULL
);


--
-- Name: roles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.roles (
    id uuid NOT NULL,
    organization_id uuid,
    name character varying(120) NOT NULL,
    name_ar character varying(120) NOT NULL,
    is_system boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: sales_invoice_lines; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sales_invoice_lines (
    id uuid NOT NULL,
    sales_invoice_id uuid NOT NULL,
    sales_order_line_id uuid,
    product_id uuid NOT NULL,
    description character varying(255) NOT NULL,
    quantity numeric(19,4) NOT NULL,
    unit_price numeric(19,4) NOT NULL,
    discount_rate numeric(8,4) DEFAULT 0 NOT NULL,
    tax_rate numeric(8,4) DEFAULT 0 NOT NULL,
    line_total numeric(19,4) NOT NULL
);


--
-- Name: sales_invoices; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sales_invoices (
    id uuid NOT NULL,
    organization_id uuid NOT NULL,
    company_id uuid NOT NULL,
    customer_id uuid NOT NULL,
    sales_order_id uuid,
    number character varying(30) NOT NULL,
    status character varying(20) DEFAULT 'draft'::character varying NOT NULL,
    invoice_date date NOT NULL,
    subtotal numeric(19,4) NOT NULL,
    tax_total numeric(19,4) NOT NULL,
    total numeric(19,4) NOT NULL,
    paid_total numeric(19,4) DEFAULT 0 NOT NULL,
    outstanding numeric(19,4) NOT NULL,
    currency character varying(3) NOT NULL,
    journal_entry_id uuid,
    idempotency_key character varying(100),
    notes text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone NOT NULL
);


--
-- Name: sales_order_lines; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sales_order_lines (
    id uuid NOT NULL,
    sales_order_id uuid NOT NULL,
    product_id uuid NOT NULL,
    description character varying(255) NOT NULL,
    quantity numeric(19,4) NOT NULL,
    delivered_quantity numeric(19,4) DEFAULT 0 NOT NULL,
    invoiced_quantity numeric(19,4) DEFAULT 0 NOT NULL,
    unit_price numeric(19,4) NOT NULL,
    discount_rate numeric(8,4) DEFAULT 0 NOT NULL,
    tax_rate numeric(8,4) DEFAULT 0 NOT NULL,
    line_total numeric(19,4) NOT NULL
);


--
-- Name: sales_orders; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sales_orders (
    id uuid NOT NULL,
    organization_id uuid NOT NULL,
    company_id uuid NOT NULL,
    customer_id uuid NOT NULL,
    quotation_id uuid,
    warehouse_id uuid NOT NULL,
    number character varying(30) NOT NULL,
    status character varying(30) DEFAULT 'draft'::character varying NOT NULL,
    subtotal numeric(19,4) NOT NULL,
    tax_total numeric(19,4) NOT NULL,
    total numeric(19,4) NOT NULL,
    currency character varying(3) NOT NULL,
    notes text,
    idempotency_key character varying(100),
    created_by uuid,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone NOT NULL
);


--
-- Name: sales_payments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sales_payments (
    id uuid NOT NULL,
    organization_id uuid NOT NULL,
    company_id uuid NOT NULL,
    customer_id uuid NOT NULL,
    number character varying(30) NOT NULL,
    status character varying(20) DEFAULT 'draft'::character varying NOT NULL,
    payment_date date NOT NULL,
    amount numeric(19,4) NOT NULL,
    currency character varying(3) NOT NULL,
    journal_entry_id uuid,
    idempotency_key character varying(100),
    notes text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone NOT NULL
);


--
-- Name: sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sessions (
    id uuid NOT NULL,
    token_hash text NOT NULL,
    user_id uuid NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    revoked_at timestamp with time zone,
    ip character varying(60),
    user_agent character varying(300),
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: stock_movements; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.stock_movements (
    id uuid NOT NULL,
    organization_id uuid NOT NULL,
    company_id uuid NOT NULL,
    warehouse_id uuid NOT NULL,
    location_id uuid,
    product_id uuid NOT NULL,
    movement_type character varying(20) NOT NULL,
    quantity numeric(19,4) NOT NULL,
    unit_cost numeric(19,4) NOT NULL,
    total_cost numeric(19,4) NOT NULL,
    source_type character varying(40),
    source_id uuid,
    movement_date date NOT NULL,
    idempotency_key character varying(100),
    created_by uuid,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: stock_reservations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.stock_reservations (
    id uuid NOT NULL,
    organization_id uuid NOT NULL,
    company_id uuid NOT NULL,
    warehouse_id uuid NOT NULL,
    product_id uuid NOT NULL,
    quantity numeric(19,4) NOT NULL,
    status character varying(20) DEFAULT 'active'::character varying NOT NULL,
    source_type character varying(40),
    source_id uuid,
    idempotency_key character varying(100),
    created_by uuid,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone NOT NULL
);


--
-- Name: storage_locations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.storage_locations (
    id uuid NOT NULL,
    warehouse_id uuid NOT NULL,
    code character varying(40) NOT NULL,
    name_ar character varying(120) NOT NULL,
    name_en character varying(120),
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: supplier_bill_lines; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.supplier_bill_lines (
    id uuid NOT NULL,
    supplier_bill_id uuid NOT NULL,
    purchase_order_line_id uuid,
    goods_receipt_line_id uuid,
    product_id uuid,
    description character varying(255) NOT NULL,
    quantity numeric(19,4) NOT NULL,
    unit_price numeric(19,4) NOT NULL,
    discount_rate numeric(8,4) DEFAULT 0 NOT NULL,
    tax_rate numeric(8,4) DEFAULT 0 NOT NULL,
    line_total numeric(19,4) NOT NULL
);


--
-- Name: supplier_bills; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.supplier_bills (
    id uuid NOT NULL,
    organization_id uuid NOT NULL,
    company_id uuid NOT NULL,
    supplier_id uuid NOT NULL,
    purchase_order_id uuid,
    goods_receipt_id uuid,
    number character varying(30) NOT NULL,
    supplier_ref character varying(60),
    status character varying(20) DEFAULT 'draft'::character varying NOT NULL,
    bill_date date NOT NULL,
    due_date date,
    subtotal numeric(19,4) NOT NULL,
    tax_total numeric(19,4) NOT NULL,
    total numeric(19,4) NOT NULL,
    paid_total numeric(19,4) DEFAULT 0 NOT NULL,
    outstanding numeric(19,4) NOT NULL,
    currency character varying(3) NOT NULL,
    notes text,
    approved_by uuid,
    approved_at timestamp with time zone,
    idempotency_key character varying(100),
    created_by uuid,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone NOT NULL
);


--
-- Name: supplier_payment_allocations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.supplier_payment_allocations (
    id uuid NOT NULL,
    organization_id uuid NOT NULL,
    supplier_payment_id uuid NOT NULL,
    supplier_bill_id uuid NOT NULL,
    amount numeric(19,4) NOT NULL
);


--
-- Name: supplier_payments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.supplier_payments (
    id uuid NOT NULL,
    organization_id uuid NOT NULL,
    company_id uuid NOT NULL,
    supplier_id uuid NOT NULL,
    number character varying(30) NOT NULL,
    status character varying(20) DEFAULT 'draft'::character varying NOT NULL,
    payment_date date NOT NULL,
    amount numeric(19,4) NOT NULL,
    currency character varying(3) NOT NULL,
    notes text,
    journal_entry_id uuid,
    idempotency_key character varying(100),
    created_by uuid,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone NOT NULL
);


--
-- Name: suppliers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.suppliers (
    id uuid NOT NULL,
    company_id uuid NOT NULL,
    number character varying(30) NOT NULL,
    name_ar character varying(160) NOT NULL,
    name_en character varying(160) NOT NULL,
    kind character varying(20) DEFAULT 'company'::character varying NOT NULL,
    tax_id character varying(60),
    payment_term_id uuid,
    credit_limit numeric(19,4),
    default_currency character varying(3) NOT NULL,
    status character varying(20) DEFAULT 'active'::character varying NOT NULL,
    salesperson_id uuid,
    created_by uuid,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone NOT NULL
);


--
-- Name: system_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.system_settings (
    id uuid NOT NULL,
    organization_id uuid,
    company_id uuid,
    key character varying(120) NOT NULL,
    value jsonb NOT NULL
);


--
-- Name: tax_codes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tax_codes (
    id uuid NOT NULL,
    company_id uuid NOT NULL,
    name_ar character varying(120) NOT NULL,
    name_en character varying(120) NOT NULL,
    rate numeric(8,4) NOT NULL,
    type character varying(20) NOT NULL,
    tax_account_id uuid,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone NOT NULL
);


--
-- Name: tax_transactions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tax_transactions (
    id uuid NOT NULL,
    company_id uuid NOT NULL,
    tax_code_id uuid NOT NULL,
    source_type character varying(60) NOT NULL,
    source_id uuid NOT NULL,
    base_amount numeric(19,4) NOT NULL,
    tax_amount numeric(19,4) NOT NULL,
    tax_date date NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: unit_conversions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.unit_conversions (
    id uuid NOT NULL,
    from_uom_id uuid NOT NULL,
    to_uom_id uuid NOT NULL,
    factor numeric(19,6) NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: units_of_measure; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.units_of_measure (
    id uuid NOT NULL,
    code character varying(20) NOT NULL,
    name_ar character varying(80) NOT NULL,
    name_en character varying(80) NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone NOT NULL
);


--
-- Name: user_roles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_roles (
    membership_id uuid NOT NULL,
    role_id uuid NOT NULL
);


--
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.users (
    id uuid NOT NULL,
    email character varying(255) NOT NULL,
    password_hash text NOT NULL,
    name character varying(120) NOT NULL,
    status character varying(20) DEFAULT 'active'::character varying NOT NULL,
    mfa_secret text,
    mfa_enabled boolean DEFAULT false NOT NULL,
    failed_attempts integer DEFAULT 0 NOT NULL,
    locked_until timestamp with time zone,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone NOT NULL
);


--
-- Name: warehouses; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.warehouses (
    id uuid NOT NULL,
    branch_id uuid NOT NULL,
    name character varying(120) NOT NULL,
    name_ar character varying(120) NOT NULL,
    status character varying(20) DEFAULT 'active'::character varying NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone NOT NULL
);


--
-- Name: _prisma_migrations _prisma_migrations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public._prisma_migrations
    ADD CONSTRAINT _prisma_migrations_pkey PRIMARY KEY (id);


--
-- Name: account_types account_types_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.account_types
    ADD CONSTRAINT account_types_pkey PRIMARY KEY (id);


--
-- Name: accounting_periods accounting_periods_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.accounting_periods
    ADD CONSTRAINT accounting_periods_pkey PRIMARY KEY (id);


--
-- Name: accounts accounts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.accounts
    ADD CONSTRAINT accounts_pkey PRIMARY KEY (id);


--
-- Name: addresses addresses_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.addresses
    ADD CONSTRAINT addresses_pkey PRIMARY KEY (id);


--
-- Name: attachments attachments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attachments
    ADD CONSTRAINT attachments_pkey PRIMARY KEY (id);


--
-- Name: audit_events audit_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_events
    ADD CONSTRAINT audit_events_pkey PRIMARY KEY (id);


--
-- Name: bank_statement_lines bank_statement_lines_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bank_statement_lines
    ADD CONSTRAINT bank_statement_lines_pkey PRIMARY KEY (id);


--
-- Name: bank_statements bank_statements_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bank_statements
    ADD CONSTRAINT bank_statements_pkey PRIMARY KEY (id);


--
-- Name: branches branches_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.branches
    ADD CONSTRAINT branches_pkey PRIMARY KEY (id);


--
-- Name: companies companies_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.companies
    ADD CONSTRAINT companies_pkey PRIMARY KEY (id);


--
-- Name: contacts contacts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contacts
    ADD CONSTRAINT contacts_pkey PRIMARY KEY (id);


--
-- Name: credit_note_lines credit_note_lines_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.credit_note_lines
    ADD CONSTRAINT credit_note_lines_pkey PRIMARY KEY (id);


--
-- Name: credit_notes credit_notes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.credit_notes
    ADD CONSTRAINT credit_notes_pkey PRIMARY KEY (id);


--
-- Name: currencies currencies_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.currencies
    ADD CONSTRAINT currencies_pkey PRIMARY KEY (code);


--
-- Name: customers customers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customers
    ADD CONSTRAINT customers_pkey PRIMARY KEY (id);


--
-- Name: deliveries deliveries_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.deliveries
    ADD CONSTRAINT deliveries_pkey PRIMARY KEY (id);


--
-- Name: delivery_lines delivery_lines_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.delivery_lines
    ADD CONSTRAINT delivery_lines_pkey PRIMARY KEY (id);


--
-- Name: document_sequences document_sequences_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.document_sequences
    ADD CONSTRAINT document_sequences_pkey PRIMARY KEY (id);


--
-- Name: expense_bill_lines expense_bill_lines_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.expense_bill_lines
    ADD CONSTRAINT expense_bill_lines_pkey PRIMARY KEY (id);


--
-- Name: expense_bills expense_bills_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.expense_bills
    ADD CONSTRAINT expense_bills_pkey PRIMARY KEY (id);


--
-- Name: fiscal_years fiscal_years_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fiscal_years
    ADD CONSTRAINT fiscal_years_pkey PRIMARY KEY (id);


--
-- Name: goods_receipt_lines goods_receipt_lines_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.goods_receipt_lines
    ADD CONSTRAINT goods_receipt_lines_pkey PRIMARY KEY (id);


--
-- Name: goods_receipts goods_receipts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.goods_receipts
    ADD CONSTRAINT goods_receipts_pkey PRIMARY KEY (id);


--
-- Name: idempotency_keys idempotency_keys_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.idempotency_keys
    ADD CONSTRAINT idempotency_keys_pkey PRIMARY KEY (key);


--
-- Name: inventory_adjustment_lines inventory_adjustment_lines_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_adjustment_lines
    ADD CONSTRAINT inventory_adjustment_lines_pkey PRIMARY KEY (id);


--
-- Name: inventory_adjustments inventory_adjustments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_adjustments
    ADD CONSTRAINT inventory_adjustments_pkey PRIMARY KEY (id);


--
-- Name: inventory_count_lines inventory_count_lines_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_count_lines
    ADD CONSTRAINT inventory_count_lines_pkey PRIMARY KEY (id);


--
-- Name: inventory_counts inventory_counts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_counts
    ADD CONSTRAINT inventory_counts_pkey PRIMARY KEY (id);


--
-- Name: inventory_transfer_lines inventory_transfer_lines_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_transfer_lines
    ADD CONSTRAINT inventory_transfer_lines_pkey PRIMARY KEY (id);


--
-- Name: inventory_transfers inventory_transfers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_transfers
    ADD CONSTRAINT inventory_transfers_pkey PRIMARY KEY (id);


--
-- Name: inventory_valuation_entries inventory_valuation_entries_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_valuation_entries
    ADD CONSTRAINT inventory_valuation_entries_pkey PRIMARY KEY (id);


--
-- Name: invitations invitations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invitations
    ADD CONSTRAINT invitations_pkey PRIMARY KEY (id);


--
-- Name: journal_entries journal_entries_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.journal_entries
    ADD CONSTRAINT journal_entries_pkey PRIMARY KEY (id);


--
-- Name: journal_lines journal_lines_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.journal_lines
    ADD CONSTRAINT journal_lines_pkey PRIMARY KEY (id);


--
-- Name: membership_branches membership_branches_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.membership_branches
    ADD CONSTRAINT membership_branches_pkey PRIMARY KEY (membership_id, branch_id);


--
-- Name: membership_companies membership_companies_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.membership_companies
    ADD CONSTRAINT membership_companies_pkey PRIMARY KEY (membership_id, company_id);


--
-- Name: memberships memberships_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.memberships
    ADD CONSTRAINT memberships_pkey PRIMARY KEY (id);


--
-- Name: notifications notifications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_pkey PRIMARY KEY (id);


--
-- Name: organizations organizations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organizations
    ADD CONSTRAINT organizations_pkey PRIMARY KEY (id);


--
-- Name: password_reset_tokens password_reset_tokens_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.password_reset_tokens
    ADD CONSTRAINT password_reset_tokens_pkey PRIMARY KEY (id);


--
-- Name: payment_allocations payment_allocations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_allocations
    ADD CONSTRAINT payment_allocations_pkey PRIMARY KEY (id);


--
-- Name: payment_terms payment_terms_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_terms
    ADD CONSTRAINT payment_terms_pkey PRIMARY KEY (id);


--
-- Name: permissions permissions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.permissions
    ADD CONSTRAINT permissions_pkey PRIMARY KEY (id);


--
-- Name: product_categories product_categories_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_categories
    ADD CONSTRAINT product_categories_pkey PRIMARY KEY (id);


--
-- Name: product_variants product_variants_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_variants
    ADD CONSTRAINT product_variants_pkey PRIMARY KEY (id);


--
-- Name: products products_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.products
    ADD CONSTRAINT products_pkey PRIMARY KEY (id);


--
-- Name: purchase_order_lines purchase_order_lines_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.purchase_order_lines
    ADD CONSTRAINT purchase_order_lines_pkey PRIMARY KEY (id);


--
-- Name: purchase_orders purchase_orders_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.purchase_orders
    ADD CONSTRAINT purchase_orders_pkey PRIMARY KEY (id);


--
-- Name: purchase_request_lines purchase_request_lines_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.purchase_request_lines
    ADD CONSTRAINT purchase_request_lines_pkey PRIMARY KEY (id);


--
-- Name: purchase_requests purchase_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.purchase_requests
    ADD CONSTRAINT purchase_requests_pkey PRIMARY KEY (id);


--
-- Name: quotation_lines quotation_lines_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.quotation_lines
    ADD CONSTRAINT quotation_lines_pkey PRIMARY KEY (id);


--
-- Name: quotations quotations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.quotations
    ADD CONSTRAINT quotations_pkey PRIMARY KEY (id);


--
-- Name: rfq_lines rfq_lines_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rfq_lines
    ADD CONSTRAINT rfq_lines_pkey PRIMARY KEY (id);


--
-- Name: rfqs rfqs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rfqs
    ADD CONSTRAINT rfqs_pkey PRIMARY KEY (id);


--
-- Name: role_permissions role_permissions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.role_permissions
    ADD CONSTRAINT role_permissions_pkey PRIMARY KEY (role_id, permission_id);


--
-- Name: roles roles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.roles
    ADD CONSTRAINT roles_pkey PRIMARY KEY (id);


--
-- Name: sales_invoice_lines sales_invoice_lines_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sales_invoice_lines
    ADD CONSTRAINT sales_invoice_lines_pkey PRIMARY KEY (id);


--
-- Name: sales_invoices sales_invoices_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sales_invoices
    ADD CONSTRAINT sales_invoices_pkey PRIMARY KEY (id);


--
-- Name: sales_order_lines sales_order_lines_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sales_order_lines
    ADD CONSTRAINT sales_order_lines_pkey PRIMARY KEY (id);


--
-- Name: sales_orders sales_orders_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sales_orders
    ADD CONSTRAINT sales_orders_pkey PRIMARY KEY (id);


--
-- Name: sales_payments sales_payments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sales_payments
    ADD CONSTRAINT sales_payments_pkey PRIMARY KEY (id);


--
-- Name: sessions sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sessions
    ADD CONSTRAINT sessions_pkey PRIMARY KEY (id);


--
-- Name: stock_movements stock_movements_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stock_movements
    ADD CONSTRAINT stock_movements_pkey PRIMARY KEY (id);


--
-- Name: stock_reservations stock_reservations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stock_reservations
    ADD CONSTRAINT stock_reservations_pkey PRIMARY KEY (id);


--
-- Name: storage_locations storage_locations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.storage_locations
    ADD CONSTRAINT storage_locations_pkey PRIMARY KEY (id);


--
-- Name: supplier_bill_lines supplier_bill_lines_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.supplier_bill_lines
    ADD CONSTRAINT supplier_bill_lines_pkey PRIMARY KEY (id);


--
-- Name: supplier_bills supplier_bills_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.supplier_bills
    ADD CONSTRAINT supplier_bills_pkey PRIMARY KEY (id);


--
-- Name: supplier_payment_allocations supplier_payment_allocations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.supplier_payment_allocations
    ADD CONSTRAINT supplier_payment_allocations_pkey PRIMARY KEY (id);


--
-- Name: supplier_payments supplier_payments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.supplier_payments
    ADD CONSTRAINT supplier_payments_pkey PRIMARY KEY (id);


--
-- Name: suppliers suppliers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.suppliers
    ADD CONSTRAINT suppliers_pkey PRIMARY KEY (id);


--
-- Name: system_settings system_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.system_settings
    ADD CONSTRAINT system_settings_pkey PRIMARY KEY (id);


--
-- Name: tax_codes tax_codes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tax_codes
    ADD CONSTRAINT tax_codes_pkey PRIMARY KEY (id);


--
-- Name: tax_transactions tax_transactions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tax_transactions
    ADD CONSTRAINT tax_transactions_pkey PRIMARY KEY (id);


--
-- Name: unit_conversions unit_conversions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.unit_conversions
    ADD CONSTRAINT unit_conversions_pkey PRIMARY KEY (id);


--
-- Name: units_of_measure units_of_measure_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.units_of_measure
    ADD CONSTRAINT units_of_measure_pkey PRIMARY KEY (id);


--
-- Name: user_roles user_roles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_roles
    ADD CONSTRAINT user_roles_pkey PRIMARY KEY (membership_id, role_id);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: warehouses warehouses_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.warehouses
    ADD CONSTRAINT warehouses_pkey PRIMARY KEY (id);


--
-- Name: account_types_code_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX account_types_code_key ON public.account_types USING btree (code);


--
-- Name: accounting_periods_company_id_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX accounting_periods_company_id_status_idx ON public.accounting_periods USING btree (company_id, status);


--
-- Name: accounting_periods_fiscal_year_id_name_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX accounting_periods_fiscal_year_id_name_key ON public.accounting_periods USING btree (fiscal_year_id, name);


--
-- Name: accounts_company_id_code_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX accounts_company_id_code_key ON public.accounts USING btree (company_id, code);


--
-- Name: accounts_company_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX accounts_company_id_idx ON public.accounts USING btree (company_id);


--
-- Name: accounts_parent_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX accounts_parent_id_idx ON public.accounts USING btree (parent_id);


--
-- Name: addresses_owner_type_owner_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX addresses_owner_type_owner_id_idx ON public.addresses USING btree (owner_type, owner_id);


--
-- Name: attachments_file_key_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX attachments_file_key_key ON public.attachments USING btree (file_key);


--
-- Name: attachments_owner_type_owner_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX attachments_owner_type_owner_id_idx ON public.attachments USING btree (owner_type, owner_id);


--
-- Name: audit_events_actor_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX audit_events_actor_id_idx ON public.audit_events USING btree (actor_id);


--
-- Name: audit_events_organization_id_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX audit_events_organization_id_created_at_idx ON public.audit_events USING btree (organization_id, created_at);


--
-- Name: bank_statement_lines_bank_statement_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX bank_statement_lines_bank_statement_id_idx ON public.bank_statement_lines USING btree (bank_statement_id);


--
-- Name: bank_statement_lines_reconciled_entry_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX bank_statement_lines_reconciled_entry_id_idx ON public.bank_statement_lines USING btree (reconciled_entry_id);


--
-- Name: bank_statements_account_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX bank_statements_account_id_idx ON public.bank_statements USING btree (account_id);


--
-- Name: bank_statements_company_id_number_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX bank_statements_company_id_number_key ON public.bank_statements USING btree (company_id, number);


--
-- Name: bank_statements_company_id_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX bank_statements_company_id_status_idx ON public.bank_statements USING btree (company_id, status);


--
-- Name: bank_statements_idempotency_key_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX bank_statements_idempotency_key_key ON public.bank_statements USING btree (idempotency_key);


--
-- Name: branches_company_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX branches_company_id_idx ON public.branches USING btree (company_id);


--
-- Name: companies_organization_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX companies_organization_id_idx ON public.companies USING btree (organization_id);


--
-- Name: contacts_owner_type_owner_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX contacts_owner_type_owner_id_idx ON public.contacts USING btree (owner_type, owner_id);


--
-- Name: credit_note_lines_credit_note_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX credit_note_lines_credit_note_id_idx ON public.credit_note_lines USING btree (credit_note_id);


--
-- Name: credit_notes_company_id_number_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX credit_notes_company_id_number_key ON public.credit_notes USING btree (company_id, number);


--
-- Name: credit_notes_company_id_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX credit_notes_company_id_status_idx ON public.credit_notes USING btree (company_id, status);


--
-- Name: credit_notes_customer_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX credit_notes_customer_id_idx ON public.credit_notes USING btree (customer_id);


--
-- Name: credit_notes_idempotency_key_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX credit_notes_idempotency_key_key ON public.credit_notes USING btree (idempotency_key);


--
-- Name: customers_company_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX customers_company_id_idx ON public.customers USING btree (company_id);


--
-- Name: customers_company_id_number_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX customers_company_id_number_key ON public.customers USING btree (company_id, number);


--
-- Name: customers_company_id_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX customers_company_id_status_idx ON public.customers USING btree (company_id, status);


--
-- Name: deliveries_company_id_number_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX deliveries_company_id_number_key ON public.deliveries USING btree (company_id, number);


--
-- Name: deliveries_company_id_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX deliveries_company_id_status_idx ON public.deliveries USING btree (company_id, status);


--
-- Name: deliveries_idempotency_key_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX deliveries_idempotency_key_key ON public.deliveries USING btree (idempotency_key);


--
-- Name: deliveries_sales_order_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX deliveries_sales_order_id_idx ON public.deliveries USING btree (sales_order_id);


--
-- Name: delivery_lines_delivery_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX delivery_lines_delivery_id_idx ON public.delivery_lines USING btree (delivery_id);


--
-- Name: document_sequences_company_id_document_type_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX document_sequences_company_id_document_type_key ON public.document_sequences USING btree (company_id, document_type);


--
-- Name: expense_bill_lines_expense_bill_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX expense_bill_lines_expense_bill_id_idx ON public.expense_bill_lines USING btree (expense_bill_id);


--
-- Name: expense_bills_company_id_number_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX expense_bills_company_id_number_key ON public.expense_bills USING btree (company_id, number);


--
-- Name: expense_bills_company_id_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX expense_bills_company_id_status_idx ON public.expense_bills USING btree (company_id, status);


--
-- Name: expense_bills_idempotency_key_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX expense_bills_idempotency_key_key ON public.expense_bills USING btree (idempotency_key);


--
-- Name: expense_bills_supplier_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX expense_bills_supplier_id_idx ON public.expense_bills USING btree (supplier_id);


--
-- Name: fiscal_years_company_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX fiscal_years_company_id_idx ON public.fiscal_years USING btree (company_id);


--
-- Name: fiscal_years_company_id_name_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX fiscal_years_company_id_name_key ON public.fiscal_years USING btree (company_id, name);


--
-- Name: goods_receipt_lines_goods_receipt_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX goods_receipt_lines_goods_receipt_id_idx ON public.goods_receipt_lines USING btree (goods_receipt_id);


--
-- Name: goods_receipts_company_id_number_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX goods_receipts_company_id_number_key ON public.goods_receipts USING btree (company_id, number);


--
-- Name: goods_receipts_company_id_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX goods_receipts_company_id_status_idx ON public.goods_receipts USING btree (company_id, status);


--
-- Name: goods_receipts_idempotency_key_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX goods_receipts_idempotency_key_key ON public.goods_receipts USING btree (idempotency_key);


--
-- Name: goods_receipts_purchase_order_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX goods_receipts_purchase_order_id_idx ON public.goods_receipts USING btree (purchase_order_id);


--
-- Name: inventory_adjustment_lines_adjustment_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX inventory_adjustment_lines_adjustment_id_idx ON public.inventory_adjustment_lines USING btree (adjustment_id);


--
-- Name: inventory_adjustments_company_id_number_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX inventory_adjustments_company_id_number_key ON public.inventory_adjustments USING btree (company_id, number);


--
-- Name: inventory_adjustments_company_id_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX inventory_adjustments_company_id_status_idx ON public.inventory_adjustments USING btree (company_id, status);


--
-- Name: inventory_adjustments_idempotency_key_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX inventory_adjustments_idempotency_key_key ON public.inventory_adjustments USING btree (idempotency_key);


--
-- Name: inventory_count_lines_count_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX inventory_count_lines_count_id_idx ON public.inventory_count_lines USING btree (count_id);


--
-- Name: inventory_counts_company_id_number_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX inventory_counts_company_id_number_key ON public.inventory_counts USING btree (company_id, number);


--
-- Name: inventory_counts_company_id_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX inventory_counts_company_id_status_idx ON public.inventory_counts USING btree (company_id, status);


--
-- Name: inventory_counts_idempotency_key_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX inventory_counts_idempotency_key_key ON public.inventory_counts USING btree (idempotency_key);


--
-- Name: inventory_transfer_lines_transfer_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX inventory_transfer_lines_transfer_id_idx ON public.inventory_transfer_lines USING btree (transfer_id);


--
-- Name: inventory_transfers_company_id_number_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX inventory_transfers_company_id_number_key ON public.inventory_transfers USING btree (company_id, number);


--
-- Name: inventory_transfers_company_id_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX inventory_transfers_company_id_status_idx ON public.inventory_transfers USING btree (company_id, status);


--
-- Name: inventory_transfers_idempotency_key_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX inventory_transfers_idempotency_key_key ON public.inventory_transfers USING btree (idempotency_key);


--
-- Name: inventory_valuation_entries_company_id_warehouse_id_product_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX inventory_valuation_entries_company_id_warehouse_id_product_idx ON public.inventory_valuation_entries USING btree (company_id, warehouse_id, product_id);


--
-- Name: inventory_valuation_entries_movement_id_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX inventory_valuation_entries_movement_id_key ON public.inventory_valuation_entries USING btree (movement_id);


--
-- Name: invitations_organization_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX invitations_organization_id_idx ON public.invitations USING btree (organization_id);


--
-- Name: invitations_token_hash_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX invitations_token_hash_key ON public.invitations USING btree (token_hash);


--
-- Name: journal_entries_company_id_posting_date_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX journal_entries_company_id_posting_date_idx ON public.journal_entries USING btree (company_id, posting_date);


--
-- Name: journal_entries_company_id_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX journal_entries_company_id_status_idx ON public.journal_entries USING btree (company_id, status);


--
-- Name: journal_entries_idempotency_key_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX journal_entries_idempotency_key_key ON public.journal_entries USING btree (idempotency_key);


--
-- Name: journal_lines_account_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX journal_lines_account_id_idx ON public.journal_lines USING btree (account_id);


--
-- Name: journal_lines_journal_entry_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX journal_lines_journal_entry_id_idx ON public.journal_lines USING btree (journal_entry_id);


--
-- Name: memberships_organization_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX memberships_organization_id_idx ON public.memberships USING btree (organization_id);


--
-- Name: memberships_user_id_organization_id_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX memberships_user_id_organization_id_key ON public.memberships USING btree (user_id, organization_id);


--
-- Name: notifications_user_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX notifications_user_created_idx ON public.notifications USING btree (user_id, created_at DESC);


--
-- Name: notifications_user_unread_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX notifications_user_unread_idx ON public.notifications USING btree (user_id) WHERE (read_at IS NULL);


--
-- Name: password_reset_tokens_token_hash_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX password_reset_tokens_token_hash_key ON public.password_reset_tokens USING btree (token_hash);


--
-- Name: payment_allocations_sales_invoice_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX payment_allocations_sales_invoice_id_idx ON public.payment_allocations USING btree (sales_invoice_id);


--
-- Name: payment_allocations_sales_payment_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX payment_allocations_sales_payment_id_idx ON public.payment_allocations USING btree (sales_payment_id);


--
-- Name: payment_terms_company_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX payment_terms_company_id_idx ON public.payment_terms USING btree (company_id);


--
-- Name: permissions_resource_action_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX permissions_resource_action_key ON public.permissions USING btree (resource, action);


--
-- Name: product_categories_company_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX product_categories_company_id_idx ON public.product_categories USING btree (company_id);


--
-- Name: product_categories_parent_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX product_categories_parent_id_idx ON public.product_categories USING btree (parent_id);


--
-- Name: product_variants_company_id_sku_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX product_variants_company_id_sku_key ON public.product_variants USING btree (company_id, sku);


--
-- Name: product_variants_product_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX product_variants_product_id_idx ON public.product_variants USING btree (product_id);


--
-- Name: products_category_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX products_category_id_idx ON public.products USING btree (category_id);


--
-- Name: products_company_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX products_company_id_idx ON public.products USING btree (company_id);


--
-- Name: products_company_id_sku_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX products_company_id_sku_key ON public.products USING btree (company_id, sku);


--
-- Name: products_company_id_type_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX products_company_id_type_idx ON public.products USING btree (company_id, type);


--
-- Name: purchase_order_lines_purchase_order_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX purchase_order_lines_purchase_order_id_idx ON public.purchase_order_lines USING btree (purchase_order_id);


--
-- Name: purchase_orders_company_id_number_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX purchase_orders_company_id_number_key ON public.purchase_orders USING btree (company_id, number);


--
-- Name: purchase_orders_company_id_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX purchase_orders_company_id_status_idx ON public.purchase_orders USING btree (company_id, status);


--
-- Name: purchase_orders_idempotency_key_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX purchase_orders_idempotency_key_key ON public.purchase_orders USING btree (idempotency_key);


--
-- Name: purchase_orders_supplier_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX purchase_orders_supplier_id_idx ON public.purchase_orders USING btree (supplier_id);


--
-- Name: purchase_request_lines_purchase_request_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX purchase_request_lines_purchase_request_id_idx ON public.purchase_request_lines USING btree (purchase_request_id);


--
-- Name: purchase_requests_company_id_number_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX purchase_requests_company_id_number_key ON public.purchase_requests USING btree (company_id, number);


--
-- Name: purchase_requests_company_id_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX purchase_requests_company_id_status_idx ON public.purchase_requests USING btree (company_id, status);


--
-- Name: purchase_requests_idempotency_key_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX purchase_requests_idempotency_key_key ON public.purchase_requests USING btree (idempotency_key);


--
-- Name: quotation_lines_quotation_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX quotation_lines_quotation_id_idx ON public.quotation_lines USING btree (quotation_id);


--
-- Name: quotations_company_id_number_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX quotations_company_id_number_key ON public.quotations USING btree (company_id, number);


--
-- Name: quotations_company_id_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX quotations_company_id_status_idx ON public.quotations USING btree (company_id, status);


--
-- Name: quotations_customer_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX quotations_customer_id_idx ON public.quotations USING btree (customer_id);


--
-- Name: quotations_idempotency_key_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX quotations_idempotency_key_key ON public.quotations USING btree (idempotency_key);


--
-- Name: rfq_lines_rfq_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX rfq_lines_rfq_id_idx ON public.rfq_lines USING btree (rfq_id);


--
-- Name: rfqs_company_id_number_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX rfqs_company_id_number_key ON public.rfqs USING btree (company_id, number);


--
-- Name: rfqs_company_id_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX rfqs_company_id_status_idx ON public.rfqs USING btree (company_id, status);


--
-- Name: rfqs_idempotency_key_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX rfqs_idempotency_key_key ON public.rfqs USING btree (idempotency_key);


--
-- Name: sales_invoice_lines_sales_invoice_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX sales_invoice_lines_sales_invoice_id_idx ON public.sales_invoice_lines USING btree (sales_invoice_id);


--
-- Name: sales_invoices_company_id_number_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX sales_invoices_company_id_number_key ON public.sales_invoices USING btree (company_id, number);


--
-- Name: sales_invoices_company_id_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX sales_invoices_company_id_status_idx ON public.sales_invoices USING btree (company_id, status);


--
-- Name: sales_invoices_customer_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX sales_invoices_customer_id_idx ON public.sales_invoices USING btree (customer_id);


--
-- Name: sales_invoices_idempotency_key_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX sales_invoices_idempotency_key_key ON public.sales_invoices USING btree (idempotency_key);


--
-- Name: sales_order_lines_sales_order_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX sales_order_lines_sales_order_id_idx ON public.sales_order_lines USING btree (sales_order_id);


--
-- Name: sales_orders_company_id_number_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX sales_orders_company_id_number_key ON public.sales_orders USING btree (company_id, number);


--
-- Name: sales_orders_company_id_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX sales_orders_company_id_status_idx ON public.sales_orders USING btree (company_id, status);


--
-- Name: sales_orders_customer_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX sales_orders_customer_id_idx ON public.sales_orders USING btree (customer_id);


--
-- Name: sales_orders_idempotency_key_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX sales_orders_idempotency_key_key ON public.sales_orders USING btree (idempotency_key);


--
-- Name: sales_payments_company_id_number_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX sales_payments_company_id_number_key ON public.sales_payments USING btree (company_id, number);


--
-- Name: sales_payments_company_id_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX sales_payments_company_id_status_idx ON public.sales_payments USING btree (company_id, status);


--
-- Name: sales_payments_customer_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX sales_payments_customer_id_idx ON public.sales_payments USING btree (customer_id);


--
-- Name: sales_payments_idempotency_key_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX sales_payments_idempotency_key_key ON public.sales_payments USING btree (idempotency_key);


--
-- Name: sessions_token_hash_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX sessions_token_hash_key ON public.sessions USING btree (token_hash);


--
-- Name: sessions_user_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX sessions_user_id_idx ON public.sessions USING btree (user_id);


--
-- Name: stock_movements_company_id_warehouse_id_product_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX stock_movements_company_id_warehouse_id_product_id_idx ON public.stock_movements USING btree (company_id, warehouse_id, product_id);


--
-- Name: stock_movements_idempotency_key_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX stock_movements_idempotency_key_key ON public.stock_movements USING btree (idempotency_key);


--
-- Name: stock_movements_product_id_movement_date_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX stock_movements_product_id_movement_date_idx ON public.stock_movements USING btree (product_id, movement_date);


--
-- Name: stock_movements_source_type_source_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX stock_movements_source_type_source_id_idx ON public.stock_movements USING btree (source_type, source_id);


--
-- Name: stock_reservations_company_id_warehouse_id_product_id_statu_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX stock_reservations_company_id_warehouse_id_product_id_statu_idx ON public.stock_reservations USING btree (company_id, warehouse_id, product_id, status);


--
-- Name: stock_reservations_idempotency_key_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX stock_reservations_idempotency_key_key ON public.stock_reservations USING btree (idempotency_key);


--
-- Name: storage_locations_warehouse_id_code_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX storage_locations_warehouse_id_code_key ON public.storage_locations USING btree (warehouse_id, code);


--
-- Name: supplier_bill_lines_supplier_bill_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX supplier_bill_lines_supplier_bill_id_idx ON public.supplier_bill_lines USING btree (supplier_bill_id);


--
-- Name: supplier_bills_company_id_number_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX supplier_bills_company_id_number_key ON public.supplier_bills USING btree (company_id, number);


--
-- Name: supplier_bills_company_id_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX supplier_bills_company_id_status_idx ON public.supplier_bills USING btree (company_id, status);


--
-- Name: supplier_bills_idempotency_key_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX supplier_bills_idempotency_key_key ON public.supplier_bills USING btree (idempotency_key);


--
-- Name: supplier_bills_supplier_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX supplier_bills_supplier_id_idx ON public.supplier_bills USING btree (supplier_id);


--
-- Name: supplier_payment_allocations_supplier_payment_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX supplier_payment_allocations_supplier_payment_id_idx ON public.supplier_payment_allocations USING btree (supplier_payment_id);


--
-- Name: supplier_payments_company_id_number_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX supplier_payments_company_id_number_key ON public.supplier_payments USING btree (company_id, number);


--
-- Name: supplier_payments_company_id_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX supplier_payments_company_id_status_idx ON public.supplier_payments USING btree (company_id, status);


--
-- Name: supplier_payments_idempotency_key_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX supplier_payments_idempotency_key_key ON public.supplier_payments USING btree (idempotency_key);


--
-- Name: supplier_payments_supplier_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX supplier_payments_supplier_id_idx ON public.supplier_payments USING btree (supplier_id);


--
-- Name: suppliers_company_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX suppliers_company_id_idx ON public.suppliers USING btree (company_id);


--
-- Name: suppliers_company_id_number_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX suppliers_company_id_number_key ON public.suppliers USING btree (company_id, number);


--
-- Name: suppliers_company_id_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX suppliers_company_id_status_idx ON public.suppliers USING btree (company_id, status);


--
-- Name: system_settings_key_organization_id_company_id_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX system_settings_key_organization_id_company_id_key ON public.system_settings USING btree (key, organization_id, company_id);


--
-- Name: tax_codes_company_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX tax_codes_company_id_idx ON public.tax_codes USING btree (company_id);


--
-- Name: tax_codes_company_id_name_en_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX tax_codes_company_id_name_en_key ON public.tax_codes USING btree (company_id, name_en);


--
-- Name: tax_transactions_company_id_tax_date_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX tax_transactions_company_id_tax_date_idx ON public.tax_transactions USING btree (company_id, tax_date);


--
-- Name: unit_conversions_from_uom_id_to_uom_id_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX unit_conversions_from_uom_id_to_uom_id_key ON public.unit_conversions USING btree (from_uom_id, to_uom_id);


--
-- Name: units_of_measure_code_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX units_of_measure_code_key ON public.units_of_measure USING btree (code);


--
-- Name: users_email_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX users_email_key ON public.users USING btree (email);


--
-- Name: warehouses_branch_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX warehouses_branch_id_idx ON public.warehouses USING btree (branch_id);


--
-- Name: accounting_periods accounting_periods_closed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.accounting_periods
    ADD CONSTRAINT accounting_periods_closed_by_fkey FOREIGN KEY (closed_by) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: accounting_periods accounting_periods_fiscal_year_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.accounting_periods
    ADD CONSTRAINT accounting_periods_fiscal_year_id_fkey FOREIGN KEY (fiscal_year_id) REFERENCES public.fiscal_years(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: accounts accounts_account_type_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.accounts
    ADD CONSTRAINT accounts_account_type_id_fkey FOREIGN KEY (account_type_id) REFERENCES public.account_types(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: accounts accounts_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.accounts
    ADD CONSTRAINT accounts_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: accounts accounts_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.accounts
    ADD CONSTRAINT accounts_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: accounts accounts_parent_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.accounts
    ADD CONSTRAINT accounts_parent_id_fkey FOREIGN KEY (parent_id) REFERENCES public.accounts(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: attachments attachments_uploaded_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attachments
    ADD CONSTRAINT attachments_uploaded_by_fkey FOREIGN KEY (uploaded_by) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: audit_events audit_events_actor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_events
    ADD CONSTRAINT audit_events_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: audit_events audit_events_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_events
    ADD CONSTRAINT audit_events_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: bank_statement_lines bank_statement_lines_bank_statement_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bank_statement_lines
    ADD CONSTRAINT bank_statement_lines_bank_statement_id_fkey FOREIGN KEY (bank_statement_id) REFERENCES public.bank_statements(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: bank_statement_lines bank_statement_lines_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bank_statement_lines
    ADD CONSTRAINT bank_statement_lines_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: bank_statement_lines bank_statement_lines_reconciled_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bank_statement_lines
    ADD CONSTRAINT bank_statement_lines_reconciled_by_fkey FOREIGN KEY (reconciled_by) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: bank_statement_lines bank_statement_lines_reconciled_entry_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bank_statement_lines
    ADD CONSTRAINT bank_statement_lines_reconciled_entry_id_fkey FOREIGN KEY (reconciled_entry_id) REFERENCES public.journal_entries(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: bank_statements bank_statements_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bank_statements
    ADD CONSTRAINT bank_statements_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.accounts(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: bank_statements bank_statements_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bank_statements
    ADD CONSTRAINT bank_statements_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: bank_statements bank_statements_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bank_statements
    ADD CONSTRAINT bank_statements_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: bank_statements bank_statements_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bank_statements
    ADD CONSTRAINT bank_statements_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: branches branches_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.branches
    ADD CONSTRAINT branches_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: companies companies_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.companies
    ADD CONSTRAINT companies_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: credit_note_lines credit_note_lines_credit_note_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.credit_note_lines
    ADD CONSTRAINT credit_note_lines_credit_note_id_fkey FOREIGN KEY (credit_note_id) REFERENCES public.credit_notes(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: credit_note_lines credit_note_lines_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.credit_note_lines
    ADD CONSTRAINT credit_note_lines_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: credit_note_lines credit_note_lines_sales_invoice_line_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.credit_note_lines
    ADD CONSTRAINT credit_note_lines_sales_invoice_line_id_fkey FOREIGN KEY (sales_invoice_line_id) REFERENCES public.sales_invoice_lines(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: credit_notes credit_notes_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.credit_notes
    ADD CONSTRAINT credit_notes_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: credit_notes credit_notes_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.credit_notes
    ADD CONSTRAINT credit_notes_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: credit_notes credit_notes_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.credit_notes
    ADD CONSTRAINT credit_notes_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: credit_notes credit_notes_journal_entry_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.credit_notes
    ADD CONSTRAINT credit_notes_journal_entry_id_fkey FOREIGN KEY (journal_entry_id) REFERENCES public.journal_entries(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: credit_notes credit_notes_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.credit_notes
    ADD CONSTRAINT credit_notes_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: credit_notes credit_notes_sales_invoice_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.credit_notes
    ADD CONSTRAINT credit_notes_sales_invoice_id_fkey FOREIGN KEY (sales_invoice_id) REFERENCES public.sales_invoices(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: customers customers_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customers
    ADD CONSTRAINT customers_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: customers customers_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customers
    ADD CONSTRAINT customers_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: customers customers_payment_term_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customers
    ADD CONSTRAINT customers_payment_term_id_fkey FOREIGN KEY (payment_term_id) REFERENCES public.payment_terms(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: customers customers_salesperson_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customers
    ADD CONSTRAINT customers_salesperson_id_fkey FOREIGN KEY (salesperson_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: deliveries deliveries_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.deliveries
    ADD CONSTRAINT deliveries_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: deliveries deliveries_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.deliveries
    ADD CONSTRAINT deliveries_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: deliveries deliveries_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.deliveries
    ADD CONSTRAINT deliveries_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: deliveries deliveries_sales_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.deliveries
    ADD CONSTRAINT deliveries_sales_order_id_fkey FOREIGN KEY (sales_order_id) REFERENCES public.sales_orders(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: deliveries deliveries_warehouse_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.deliveries
    ADD CONSTRAINT deliveries_warehouse_id_fkey FOREIGN KEY (warehouse_id) REFERENCES public.warehouses(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: delivery_lines delivery_lines_delivery_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.delivery_lines
    ADD CONSTRAINT delivery_lines_delivery_id_fkey FOREIGN KEY (delivery_id) REFERENCES public.deliveries(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: delivery_lines delivery_lines_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.delivery_lines
    ADD CONSTRAINT delivery_lines_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: delivery_lines delivery_lines_sales_order_line_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.delivery_lines
    ADD CONSTRAINT delivery_lines_sales_order_line_id_fkey FOREIGN KEY (sales_order_line_id) REFERENCES public.sales_order_lines(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: document_sequences document_sequences_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.document_sequences
    ADD CONSTRAINT document_sequences_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: expense_bill_lines expense_bill_lines_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.expense_bill_lines
    ADD CONSTRAINT expense_bill_lines_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.accounts(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: expense_bill_lines expense_bill_lines_expense_bill_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.expense_bill_lines
    ADD CONSTRAINT expense_bill_lines_expense_bill_id_fkey FOREIGN KEY (expense_bill_id) REFERENCES public.expense_bills(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: expense_bill_lines expense_bill_lines_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.expense_bill_lines
    ADD CONSTRAINT expense_bill_lines_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: expense_bills expense_bills_bank_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.expense_bills
    ADD CONSTRAINT expense_bills_bank_account_id_fkey FOREIGN KEY (bank_account_id) REFERENCES public.accounts(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: expense_bills expense_bills_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.expense_bills
    ADD CONSTRAINT expense_bills_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: expense_bills expense_bills_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.expense_bills
    ADD CONSTRAINT expense_bills_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: expense_bills expense_bills_journal_entry_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.expense_bills
    ADD CONSTRAINT expense_bills_journal_entry_id_fkey FOREIGN KEY (journal_entry_id) REFERENCES public.journal_entries(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: expense_bills expense_bills_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.expense_bills
    ADD CONSTRAINT expense_bills_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: expense_bills expense_bills_supplier_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.expense_bills
    ADD CONSTRAINT expense_bills_supplier_id_fkey FOREIGN KEY (supplier_id) REFERENCES public.suppliers(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: fiscal_years fiscal_years_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fiscal_years
    ADD CONSTRAINT fiscal_years_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: goods_receipt_lines goods_receipt_lines_goods_receipt_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.goods_receipt_lines
    ADD CONSTRAINT goods_receipt_lines_goods_receipt_id_fkey FOREIGN KEY (goods_receipt_id) REFERENCES public.goods_receipts(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: goods_receipt_lines goods_receipt_lines_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.goods_receipt_lines
    ADD CONSTRAINT goods_receipt_lines_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: goods_receipt_lines goods_receipt_lines_purchase_order_line_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.goods_receipt_lines
    ADD CONSTRAINT goods_receipt_lines_purchase_order_line_id_fkey FOREIGN KEY (purchase_order_line_id) REFERENCES public.purchase_order_lines(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: goods_receipts goods_receipts_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.goods_receipts
    ADD CONSTRAINT goods_receipts_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: goods_receipts goods_receipts_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.goods_receipts
    ADD CONSTRAINT goods_receipts_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: goods_receipts goods_receipts_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.goods_receipts
    ADD CONSTRAINT goods_receipts_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: goods_receipts goods_receipts_purchase_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.goods_receipts
    ADD CONSTRAINT goods_receipts_purchase_order_id_fkey FOREIGN KEY (purchase_order_id) REFERENCES public.purchase_orders(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: goods_receipts goods_receipts_warehouse_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.goods_receipts
    ADD CONSTRAINT goods_receipts_warehouse_id_fkey FOREIGN KEY (warehouse_id) REFERENCES public.warehouses(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: inventory_adjustment_lines inventory_adjustment_lines_adjustment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_adjustment_lines
    ADD CONSTRAINT inventory_adjustment_lines_adjustment_id_fkey FOREIGN KEY (adjustment_id) REFERENCES public.inventory_adjustments(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: inventory_adjustment_lines inventory_adjustment_lines_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_adjustment_lines
    ADD CONSTRAINT inventory_adjustment_lines_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: inventory_adjustments inventory_adjustments_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_adjustments
    ADD CONSTRAINT inventory_adjustments_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: inventory_adjustments inventory_adjustments_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_adjustments
    ADD CONSTRAINT inventory_adjustments_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: inventory_adjustments inventory_adjustments_warehouse_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_adjustments
    ADD CONSTRAINT inventory_adjustments_warehouse_id_fkey FOREIGN KEY (warehouse_id) REFERENCES public.warehouses(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: inventory_count_lines inventory_count_lines_count_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_count_lines
    ADD CONSTRAINT inventory_count_lines_count_id_fkey FOREIGN KEY (count_id) REFERENCES public.inventory_counts(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: inventory_count_lines inventory_count_lines_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_count_lines
    ADD CONSTRAINT inventory_count_lines_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: inventory_counts inventory_counts_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_counts
    ADD CONSTRAINT inventory_counts_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: inventory_counts inventory_counts_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_counts
    ADD CONSTRAINT inventory_counts_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: inventory_counts inventory_counts_warehouse_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_counts
    ADD CONSTRAINT inventory_counts_warehouse_id_fkey FOREIGN KEY (warehouse_id) REFERENCES public.warehouses(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: inventory_transfer_lines inventory_transfer_lines_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_transfer_lines
    ADD CONSTRAINT inventory_transfer_lines_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: inventory_transfer_lines inventory_transfer_lines_transfer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_transfer_lines
    ADD CONSTRAINT inventory_transfer_lines_transfer_id_fkey FOREIGN KEY (transfer_id) REFERENCES public.inventory_transfers(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: inventory_transfers inventory_transfers_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_transfers
    ADD CONSTRAINT inventory_transfers_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: inventory_transfers inventory_transfers_from_warehouse_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_transfers
    ADD CONSTRAINT inventory_transfers_from_warehouse_id_fkey FOREIGN KEY (from_warehouse_id) REFERENCES public.warehouses(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: inventory_transfers inventory_transfers_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_transfers
    ADD CONSTRAINT inventory_transfers_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: inventory_transfers inventory_transfers_to_warehouse_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_transfers
    ADD CONSTRAINT inventory_transfers_to_warehouse_id_fkey FOREIGN KEY (to_warehouse_id) REFERENCES public.warehouses(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: inventory_valuation_entries inventory_valuation_entries_movement_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_valuation_entries
    ADD CONSTRAINT inventory_valuation_entries_movement_id_fkey FOREIGN KEY (movement_id) REFERENCES public.stock_movements(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: invitations invitations_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invitations
    ADD CONSTRAINT invitations_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: journal_entries journal_entries_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.journal_entries
    ADD CONSTRAINT journal_entries_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: journal_entries journal_entries_period_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.journal_entries
    ADD CONSTRAINT journal_entries_period_id_fkey FOREIGN KEY (period_id) REFERENCES public.accounting_periods(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: journal_entries journal_entries_posted_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.journal_entries
    ADD CONSTRAINT journal_entries_posted_by_fkey FOREIGN KEY (posted_by) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: journal_entries journal_entries_reversal_of_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.journal_entries
    ADD CONSTRAINT journal_entries_reversal_of_id_fkey FOREIGN KEY (reversal_of_id) REFERENCES public.journal_entries(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: journal_lines journal_lines_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.journal_lines
    ADD CONSTRAINT journal_lines_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.accounts(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: journal_lines journal_lines_journal_entry_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.journal_lines
    ADD CONSTRAINT journal_lines_journal_entry_id_fkey FOREIGN KEY (journal_entry_id) REFERENCES public.journal_entries(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: journal_lines journal_lines_tax_code_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.journal_lines
    ADD CONSTRAINT journal_lines_tax_code_id_fkey FOREIGN KEY (tax_code_id) REFERENCES public.tax_codes(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: membership_branches membership_branches_membership_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.membership_branches
    ADD CONSTRAINT membership_branches_membership_id_fkey FOREIGN KEY (membership_id) REFERENCES public.memberships(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: membership_companies membership_companies_membership_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.membership_companies
    ADD CONSTRAINT membership_companies_membership_id_fkey FOREIGN KEY (membership_id) REFERENCES public.memberships(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: memberships memberships_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.memberships
    ADD CONSTRAINT memberships_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: memberships memberships_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.memberships
    ADD CONSTRAINT memberships_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: notifications notifications_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: notifications notifications_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: password_reset_tokens password_reset_tokens_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.password_reset_tokens
    ADD CONSTRAINT password_reset_tokens_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: payment_allocations payment_allocations_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_allocations
    ADD CONSTRAINT payment_allocations_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: payment_allocations payment_allocations_sales_invoice_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_allocations
    ADD CONSTRAINT payment_allocations_sales_invoice_id_fkey FOREIGN KEY (sales_invoice_id) REFERENCES public.sales_invoices(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: payment_allocations payment_allocations_sales_payment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_allocations
    ADD CONSTRAINT payment_allocations_sales_payment_id_fkey FOREIGN KEY (sales_payment_id) REFERENCES public.sales_payments(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: payment_terms payment_terms_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_terms
    ADD CONSTRAINT payment_terms_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: product_categories product_categories_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_categories
    ADD CONSTRAINT product_categories_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: product_categories product_categories_parent_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_categories
    ADD CONSTRAINT product_categories_parent_id_fkey FOREIGN KEY (parent_id) REFERENCES public.product_categories(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: product_variants product_variants_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_variants
    ADD CONSTRAINT product_variants_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: product_variants product_variants_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_variants
    ADD CONSTRAINT product_variants_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: products products_base_uom_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.products
    ADD CONSTRAINT products_base_uom_id_fkey FOREIGN KEY (base_uom_id) REFERENCES public.units_of_measure(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: products products_category_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.products
    ADD CONSTRAINT products_category_id_fkey FOREIGN KEY (category_id) REFERENCES public.product_categories(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: products products_cogs_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.products
    ADD CONSTRAINT products_cogs_account_id_fkey FOREIGN KEY (cogs_account_id) REFERENCES public.accounts(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: products products_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.products
    ADD CONSTRAINT products_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: products products_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.products
    ADD CONSTRAINT products_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: products products_inventory_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.products
    ADD CONSTRAINT products_inventory_account_id_fkey FOREIGN KEY (inventory_account_id) REFERENCES public.accounts(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: products products_preferred_supplier_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.products
    ADD CONSTRAINT products_preferred_supplier_id_fkey FOREIGN KEY (preferred_supplier_id) REFERENCES public.suppliers(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: products products_revenue_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.products
    ADD CONSTRAINT products_revenue_account_id_fkey FOREIGN KEY (revenue_account_id) REFERENCES public.accounts(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: products products_tax_code_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.products
    ADD CONSTRAINT products_tax_code_id_fkey FOREIGN KEY (tax_code_id) REFERENCES public.tax_codes(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: purchase_order_lines purchase_order_lines_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.purchase_order_lines
    ADD CONSTRAINT purchase_order_lines_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: purchase_order_lines purchase_order_lines_purchase_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.purchase_order_lines
    ADD CONSTRAINT purchase_order_lines_purchase_order_id_fkey FOREIGN KEY (purchase_order_id) REFERENCES public.purchase_orders(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: purchase_orders purchase_orders_approved_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.purchase_orders
    ADD CONSTRAINT purchase_orders_approved_by_fkey FOREIGN KEY (approved_by) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: purchase_orders purchase_orders_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.purchase_orders
    ADD CONSTRAINT purchase_orders_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: purchase_orders purchase_orders_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.purchase_orders
    ADD CONSTRAINT purchase_orders_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: purchase_orders purchase_orders_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.purchase_orders
    ADD CONSTRAINT purchase_orders_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: purchase_orders purchase_orders_purchase_request_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.purchase_orders
    ADD CONSTRAINT purchase_orders_purchase_request_id_fkey FOREIGN KEY (purchase_request_id) REFERENCES public.purchase_requests(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: purchase_orders purchase_orders_requested_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.purchase_orders
    ADD CONSTRAINT purchase_orders_requested_by_fkey FOREIGN KEY (requested_by) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: purchase_orders purchase_orders_rfq_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.purchase_orders
    ADD CONSTRAINT purchase_orders_rfq_id_fkey FOREIGN KEY (rfq_id) REFERENCES public.rfqs(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: purchase_orders purchase_orders_supplier_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.purchase_orders
    ADD CONSTRAINT purchase_orders_supplier_id_fkey FOREIGN KEY (supplier_id) REFERENCES public.suppliers(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: purchase_orders purchase_orders_warehouse_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.purchase_orders
    ADD CONSTRAINT purchase_orders_warehouse_id_fkey FOREIGN KEY (warehouse_id) REFERENCES public.warehouses(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: purchase_request_lines purchase_request_lines_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.purchase_request_lines
    ADD CONSTRAINT purchase_request_lines_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: purchase_request_lines purchase_request_lines_purchase_request_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.purchase_request_lines
    ADD CONSTRAINT purchase_request_lines_purchase_request_id_fkey FOREIGN KEY (purchase_request_id) REFERENCES public.purchase_requests(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: purchase_requests purchase_requests_approved_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.purchase_requests
    ADD CONSTRAINT purchase_requests_approved_by_fkey FOREIGN KEY (approved_by) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: purchase_requests purchase_requests_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.purchase_requests
    ADD CONSTRAINT purchase_requests_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: purchase_requests purchase_requests_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.purchase_requests
    ADD CONSTRAINT purchase_requests_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: purchase_requests purchase_requests_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.purchase_requests
    ADD CONSTRAINT purchase_requests_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: purchase_requests purchase_requests_requested_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.purchase_requests
    ADD CONSTRAINT purchase_requests_requested_by_fkey FOREIGN KEY (requested_by) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: quotation_lines quotation_lines_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.quotation_lines
    ADD CONSTRAINT quotation_lines_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: quotation_lines quotation_lines_quotation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.quotation_lines
    ADD CONSTRAINT quotation_lines_quotation_id_fkey FOREIGN KEY (quotation_id) REFERENCES public.quotations(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: quotations quotations_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.quotations
    ADD CONSTRAINT quotations_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: quotations quotations_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.quotations
    ADD CONSTRAINT quotations_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: quotations quotations_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.quotations
    ADD CONSTRAINT quotations_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: quotations quotations_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.quotations
    ADD CONSTRAINT quotations_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: rfq_lines rfq_lines_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rfq_lines
    ADD CONSTRAINT rfq_lines_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: rfq_lines rfq_lines_rfq_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rfq_lines
    ADD CONSTRAINT rfq_lines_rfq_id_fkey FOREIGN KEY (rfq_id) REFERENCES public.rfqs(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: rfq_lines rfq_lines_supplier_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rfq_lines
    ADD CONSTRAINT rfq_lines_supplier_id_fkey FOREIGN KEY (supplier_id) REFERENCES public.suppliers(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: rfqs rfqs_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rfqs
    ADD CONSTRAINT rfqs_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: rfqs rfqs_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rfqs
    ADD CONSTRAINT rfqs_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: rfqs rfqs_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rfqs
    ADD CONSTRAINT rfqs_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: rfqs rfqs_purchase_request_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rfqs
    ADD CONSTRAINT rfqs_purchase_request_id_fkey FOREIGN KEY (purchase_request_id) REFERENCES public.purchase_requests(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: rfqs rfqs_supplier_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rfqs
    ADD CONSTRAINT rfqs_supplier_id_fkey FOREIGN KEY (supplier_id) REFERENCES public.suppliers(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: role_permissions role_permissions_permission_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.role_permissions
    ADD CONSTRAINT role_permissions_permission_id_fkey FOREIGN KEY (permission_id) REFERENCES public.permissions(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: role_permissions role_permissions_role_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.role_permissions
    ADD CONSTRAINT role_permissions_role_id_fkey FOREIGN KEY (role_id) REFERENCES public.roles(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: roles roles_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.roles
    ADD CONSTRAINT roles_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: sales_invoice_lines sales_invoice_lines_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sales_invoice_lines
    ADD CONSTRAINT sales_invoice_lines_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: sales_invoice_lines sales_invoice_lines_sales_invoice_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sales_invoice_lines
    ADD CONSTRAINT sales_invoice_lines_sales_invoice_id_fkey FOREIGN KEY (sales_invoice_id) REFERENCES public.sales_invoices(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: sales_invoice_lines sales_invoice_lines_sales_order_line_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sales_invoice_lines
    ADD CONSTRAINT sales_invoice_lines_sales_order_line_id_fkey FOREIGN KEY (sales_order_line_id) REFERENCES public.sales_order_lines(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: sales_invoices sales_invoices_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sales_invoices
    ADD CONSTRAINT sales_invoices_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: sales_invoices sales_invoices_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sales_invoices
    ADD CONSTRAINT sales_invoices_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: sales_invoices sales_invoices_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sales_invoices
    ADD CONSTRAINT sales_invoices_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: sales_invoices sales_invoices_journal_entry_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sales_invoices
    ADD CONSTRAINT sales_invoices_journal_entry_id_fkey FOREIGN KEY (journal_entry_id) REFERENCES public.journal_entries(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: sales_invoices sales_invoices_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sales_invoices
    ADD CONSTRAINT sales_invoices_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: sales_invoices sales_invoices_sales_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sales_invoices
    ADD CONSTRAINT sales_invoices_sales_order_id_fkey FOREIGN KEY (sales_order_id) REFERENCES public.sales_orders(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: sales_order_lines sales_order_lines_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sales_order_lines
    ADD CONSTRAINT sales_order_lines_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: sales_order_lines sales_order_lines_sales_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sales_order_lines
    ADD CONSTRAINT sales_order_lines_sales_order_id_fkey FOREIGN KEY (sales_order_id) REFERENCES public.sales_orders(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: sales_orders sales_orders_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sales_orders
    ADD CONSTRAINT sales_orders_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: sales_orders sales_orders_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sales_orders
    ADD CONSTRAINT sales_orders_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: sales_orders sales_orders_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sales_orders
    ADD CONSTRAINT sales_orders_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: sales_orders sales_orders_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sales_orders
    ADD CONSTRAINT sales_orders_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: sales_orders sales_orders_quotation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sales_orders
    ADD CONSTRAINT sales_orders_quotation_id_fkey FOREIGN KEY (quotation_id) REFERENCES public.quotations(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: sales_orders sales_orders_warehouse_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sales_orders
    ADD CONSTRAINT sales_orders_warehouse_id_fkey FOREIGN KEY (warehouse_id) REFERENCES public.warehouses(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: sales_payments sales_payments_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sales_payments
    ADD CONSTRAINT sales_payments_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: sales_payments sales_payments_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sales_payments
    ADD CONSTRAINT sales_payments_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: sales_payments sales_payments_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sales_payments
    ADD CONSTRAINT sales_payments_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: sales_payments sales_payments_journal_entry_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sales_payments
    ADD CONSTRAINT sales_payments_journal_entry_id_fkey FOREIGN KEY (journal_entry_id) REFERENCES public.journal_entries(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: sales_payments sales_payments_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sales_payments
    ADD CONSTRAINT sales_payments_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: sessions sessions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sessions
    ADD CONSTRAINT sessions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: stock_movements stock_movements_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stock_movements
    ADD CONSTRAINT stock_movements_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: stock_movements stock_movements_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stock_movements
    ADD CONSTRAINT stock_movements_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: stock_movements stock_movements_location_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stock_movements
    ADD CONSTRAINT stock_movements_location_id_fkey FOREIGN KEY (location_id) REFERENCES public.storage_locations(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: stock_movements stock_movements_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stock_movements
    ADD CONSTRAINT stock_movements_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: stock_movements stock_movements_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stock_movements
    ADD CONSTRAINT stock_movements_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: stock_movements stock_movements_warehouse_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stock_movements
    ADD CONSTRAINT stock_movements_warehouse_id_fkey FOREIGN KEY (warehouse_id) REFERENCES public.warehouses(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: stock_reservations stock_reservations_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stock_reservations
    ADD CONSTRAINT stock_reservations_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: stock_reservations stock_reservations_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stock_reservations
    ADD CONSTRAINT stock_reservations_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: stock_reservations stock_reservations_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stock_reservations
    ADD CONSTRAINT stock_reservations_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: stock_reservations stock_reservations_warehouse_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stock_reservations
    ADD CONSTRAINT stock_reservations_warehouse_id_fkey FOREIGN KEY (warehouse_id) REFERENCES public.warehouses(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: storage_locations storage_locations_warehouse_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.storage_locations
    ADD CONSTRAINT storage_locations_warehouse_id_fkey FOREIGN KEY (warehouse_id) REFERENCES public.warehouses(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: supplier_bill_lines supplier_bill_lines_goods_receipt_line_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.supplier_bill_lines
    ADD CONSTRAINT supplier_bill_lines_goods_receipt_line_id_fkey FOREIGN KEY (goods_receipt_line_id) REFERENCES public.goods_receipt_lines(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: supplier_bill_lines supplier_bill_lines_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.supplier_bill_lines
    ADD CONSTRAINT supplier_bill_lines_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: supplier_bill_lines supplier_bill_lines_purchase_order_line_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.supplier_bill_lines
    ADD CONSTRAINT supplier_bill_lines_purchase_order_line_id_fkey FOREIGN KEY (purchase_order_line_id) REFERENCES public.purchase_order_lines(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: supplier_bill_lines supplier_bill_lines_supplier_bill_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.supplier_bill_lines
    ADD CONSTRAINT supplier_bill_lines_supplier_bill_id_fkey FOREIGN KEY (supplier_bill_id) REFERENCES public.supplier_bills(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: supplier_bills supplier_bills_approved_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.supplier_bills
    ADD CONSTRAINT supplier_bills_approved_by_fkey FOREIGN KEY (approved_by) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: supplier_bills supplier_bills_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.supplier_bills
    ADD CONSTRAINT supplier_bills_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: supplier_bills supplier_bills_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.supplier_bills
    ADD CONSTRAINT supplier_bills_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: supplier_bills supplier_bills_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.supplier_bills
    ADD CONSTRAINT supplier_bills_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: supplier_bills supplier_bills_purchase_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.supplier_bills
    ADD CONSTRAINT supplier_bills_purchase_order_id_fkey FOREIGN KEY (purchase_order_id) REFERENCES public.purchase_orders(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: supplier_bills supplier_bills_supplier_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.supplier_bills
    ADD CONSTRAINT supplier_bills_supplier_id_fkey FOREIGN KEY (supplier_id) REFERENCES public.suppliers(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: supplier_payment_allocations supplier_payment_allocations_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.supplier_payment_allocations
    ADD CONSTRAINT supplier_payment_allocations_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: supplier_payment_allocations supplier_payment_allocations_supplier_bill_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.supplier_payment_allocations
    ADD CONSTRAINT supplier_payment_allocations_supplier_bill_id_fkey FOREIGN KEY (supplier_bill_id) REFERENCES public.supplier_bills(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: supplier_payment_allocations supplier_payment_allocations_supplier_payment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.supplier_payment_allocations
    ADD CONSTRAINT supplier_payment_allocations_supplier_payment_id_fkey FOREIGN KEY (supplier_payment_id) REFERENCES public.supplier_payments(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: supplier_payments supplier_payments_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.supplier_payments
    ADD CONSTRAINT supplier_payments_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: supplier_payments supplier_payments_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.supplier_payments
    ADD CONSTRAINT supplier_payments_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: supplier_payments supplier_payments_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.supplier_payments
    ADD CONSTRAINT supplier_payments_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: supplier_payments supplier_payments_supplier_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.supplier_payments
    ADD CONSTRAINT supplier_payments_supplier_id_fkey FOREIGN KEY (supplier_id) REFERENCES public.suppliers(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: suppliers suppliers_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.suppliers
    ADD CONSTRAINT suppliers_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: suppliers suppliers_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.suppliers
    ADD CONSTRAINT suppliers_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: suppliers suppliers_default_currency_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.suppliers
    ADD CONSTRAINT suppliers_default_currency_fkey FOREIGN KEY (default_currency) REFERENCES public.currencies(code) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: suppliers suppliers_payment_term_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.suppliers
    ADD CONSTRAINT suppliers_payment_term_id_fkey FOREIGN KEY (payment_term_id) REFERENCES public.payment_terms(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: suppliers suppliers_salesperson_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.suppliers
    ADD CONSTRAINT suppliers_salesperson_id_fkey FOREIGN KEY (salesperson_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: tax_codes tax_codes_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tax_codes
    ADD CONSTRAINT tax_codes_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: tax_codes tax_codes_tax_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tax_codes
    ADD CONSTRAINT tax_codes_tax_account_id_fkey FOREIGN KEY (tax_account_id) REFERENCES public.accounts(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: unit_conversions unit_conversions_from_uom_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.unit_conversions
    ADD CONSTRAINT unit_conversions_from_uom_id_fkey FOREIGN KEY (from_uom_id) REFERENCES public.units_of_measure(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: unit_conversions unit_conversions_to_uom_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.unit_conversions
    ADD CONSTRAINT unit_conversions_to_uom_id_fkey FOREIGN KEY (to_uom_id) REFERENCES public.units_of_measure(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: user_roles user_roles_membership_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_roles
    ADD CONSTRAINT user_roles_membership_id_fkey FOREIGN KEY (membership_id) REFERENCES public.memberships(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: user_roles user_roles_role_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_roles
    ADD CONSTRAINT user_roles_role_id_fkey FOREIGN KEY (role_id) REFERENCES public.roles(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: warehouses warehouses_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.warehouses
    ADD CONSTRAINT warehouses_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES public.branches(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- PostgreSQL database dump complete
--

