/**
 * E2E: Phase 3 accounting — CoA seed, fiscal years/periods, journal lifecycle,
 * posting engine invariants, idempotency, reversal, trial balance, tax codes.
 * Runs against the isolated atlas_erp_test database.
 */
import { INestApplication } from '@nestjs/common';
import { createTestApp, TestClient, TEST_DB_URL, resetTestDb } from './helpers';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient({ datasourceUrl: TEST_DB_URL });
const ADMIN_EMAIL = 'acct-admin@atlas.test';
const ADMIN_PASSWORD = 'test-password-123';

describe('Accounting (e2e)', () => {
  let app: INestApplication;
  let client: TestClient;
  let orgId: string;
  let companyId: string;
  let company2Id: string;
  const accounts = new Map<string, string>(); // code -> id (company 1)

  const line = (code: string, debit: string, credit: string) => ({
    account_id: accounts.get(code)!,
    debit,
    credit,
  });

  beforeAll(async () => {
    resetTestDb();
    ({ app, client } = await createTestApp());

    // First-run bootstrap (also seeds the standard CoA via the new hook).
    const fr = await client.post('/api/v1/auth/first-run', {
      organizationName: 'Acct Org',
      organizationNameAr: 'منظمة الحسابات',
      adminName: 'Acct Admin',
      adminEmail: ADMIN_EMAIL,
      password: ADMIN_PASSWORD,
    });
    expect(fr.status).toBe(201);
    orgId = fr.body.organization.id;
    companyId = fr.body.company.id;
    client.orgId = orgId;
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  });

  it('auto-seeds the standard CoA when the company is created', async () => {
    const res = await client.get(`/api/v1/accounts?company_id=${companyId}`);
    expect(res.status).toBe(200);
    const accountsList = res.body as Array<{
      code: string; id: string; is_postable: boolean; account_type: { code: string };
    }>;
    expect(accountsList).toHaveLength(19);
    const byCode = new Map(accountsList.map((a) => [a.code, a.id]));
    for (const c of ['1000', '1100', '1110', '1210', '1230', '1310', '1320', '2110', '2120', '3010', '3020', '4110', '5110', '5210']) {
      expect(byCode.has(c)).toBe(true);
      accounts.set(c, byCode.get(c)!);
    }
    const summary = accountsList.find((a) => a.code === '1000');
    expect(summary!.is_postable).toBe(false);
    expect(summary!.account_type.code).toBe('ASSET');
  });

  it('seed endpoint is idempotent (skips when accounts exist)', async () => {
    const res = await client.post(`/api/v1/companies/${companyId}/chart-of-accounts/seed`, {});
    expect(res.status).toBe(201);
    expect(res.body.skipped).toBe(true);
  });

  it('creates accounts with an account-type CODE (web contract)', async () => {
    const res = await client.post('/api/v1/accounts', {
      company_id: companyId,
      code: '1120',
      name_ar: 'حساب اختبار',
      name_en: 'Test account',
      account_type_id: 'ASSET', // code string, not UUID
      parent_id: accounts.get('1000'),
    });
    expect(res.status).toBe(201);
    expect(res.body.account_type.code).toBe('ASSET');
    accounts.set('1120', res.body.id);
  });

  it('rejects duplicate account codes (409)', async () => {
    const res = await client.post('/api/v1/accounts', {
      company_id: companyId,
      code: '1120',
      name_ar: 'مكرر',
      name_en: 'Duplicate',
      account_type_id: 'ASSET',
    });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('DUPLICATE');
  });

  it('creates a fiscal year with 12 monthly periods', async () => {
    const res = await client.post('/api/v1/fiscal-years', {
      company_id: companyId,
      name: 'FY2026',
      start_date: '2026-01-01',
      end_date: '2026-12-31',
    });
    expect(res.status).toBe(201);
    expect(res.body.periods_created).toBe(12);
    const periods = await client.get(`/api/v1/accounting-periods?fiscal_year_id=${res.body.id}`);
    expect(periods.status).toBe(200);
    expect(periods.body).toHaveLength(12);
    expect(periods.body[0].name).toBe('2026-01');
    expect(periods.body.every((p: { status: string }) => p.status === 'open')).toBe(true);
  });

  it('rejects a fiscal year that is not 12 whole months (400)', async () => {
    const res = await client.post('/api/v1/fiscal-years', {
      company_id: companyId,
      name: 'BAD',
      start_date: '2026-01-15',
      end_date: '2026-12-31',
    });
    expect(res.status).toBe(400);
  });

  let journalId: string;

  it('runs the full draft -> submitted -> approved -> posted lifecycle', async () => {
    const created = await client.post('/api/v1/journal-entries', {
      company_id: companyId,
      posting_date: '2026-11-03',
      description: 'Opening capital',
      lines: [line('1100', '2000.00', '0'), line('3010', '0', '2000.00')],
    });
    expect(created.status).toBe(201);
    expect(created.body.status).toBe('draft');
    expect(created.body.version).toBe(1);
    expect(created.body.total_debit).toBe('2000.00');
    journalId = created.body.id;

    const submitted = await client.post(`/api/v1/journal-entries/${journalId}/submit`, {});
    expect(submitted.body.status).toBe('submitted');

    const approved = await client.post(`/api/v1/journal-entries/${journalId}/approve`, { comment: 'ok' });
    expect(approved.body.status).toBe('approved');

    const posted = await client.post(`/api/v1/journal-entries/${journalId}/post`, { version: 1 });
    expect(posted.status).toBe(200);
    expect(posted.body.status).toBe('posted');
    expect(posted.body.version).toBe(2);
    expect(posted.body.period_id).toBeTruthy();
  });

  it('re-post is an idempotent no-op (200, same entry, no duplicate lines)', async () => {
    const again = await client.post(`/api/v1/journal-entries/${journalId}/post`, { version: 1 });
    expect(again.status).toBe(200);
    expect(again.body.id).toBe(journalId);
    expect(again.body.lines).toHaveLength(2);
    const count = await prisma.journalLine.count({ where: { journalEntryId: journalId } });
    expect(count).toBe(2);
  });

  it('rejects an unbalanced journal at post time (422 UNBALANCED_JOURNAL)', async () => {
    const created = await client.post('/api/v1/journal-entries', {
      company_id: companyId,
      posting_date: '2026-11-03',
      description: 'Unbalanced',
      lines: [line('1100', '100.00', '0'), line('5210', '0', '99.99')],
    });
    const id = created.body.id;
    await client.post(`/api/v1/journal-entries/${id}/submit`, {});
    await client.post(`/api/v1/journal-entries/${id}/approve`, {});
    const posted = await client.post(`/api/v1/journal-entries/${id}/post`, { version: 1 });
    expect(posted.status).toBe(422);
    expect(posted.body.code).toBe('UNBALANCED_JOURNAL');
    expect(posted.body.details.total_debit).toBe('100.00');
    expect(posted.body.details.total_credit).toBe('99.99');
    expect(posted.body.message_ar).toBeDefined();
  });

  it('rejects a line on a non-postable summary account (422 ACCOUNT_NOT_POSTABLE)', async () => {
    const res = await client.post('/api/v1/journal-entries', {
      company_id: companyId,
      posting_date: '2026-11-03',
      description: 'Summary line',
      lines: [
        { account_id: accounts.get('1000'), debit: '10', credit: '0' },
        line('1100', '0', '10'),
      ],
    });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('ACCOUNT_NOT_POSTABLE');
  });

  it('rejects a line on another company\'s account (422 ACCOUNT_COMPANY_MISMATCH)', async () => {
    const c2 = await client.post('/api/v1/companies', {
      organizationId: orgId,
      name: 'Second Co',
      nameAr: 'شركة ثانية',
    });
    expect(c2.status).toBe(201);
    company2Id = c2.body.id;
    const c2Accounts = await client.get(`/api/v1/accounts?company_id=${company2Id}`);
    const otherCash = c2Accounts.body.find((a: { code: string }) => a.code === '1100').id;
    const res = await client.post('/api/v1/journal-entries', {
      company_id: companyId,
      posting_date: '2026-11-03',
      description: 'Cross-company',
      lines: [
        { account_id: otherCash, debit: '10', credit: '0' },
        line('1100', '0', '10'),
      ],
    });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('ACCOUNT_COMPANY_MISMATCH');
  });

  it('rejects PATCH/DELETE on a posted entry (409)', async () => {
    const patch = await client.patch(`/api/v1/journal-entries/${journalId}`, {
      description: 'changed',
      lines: [line('1100', '1', '0'), line('3010', '0', '1')],
    });
    expect(patch.status).toBe(409);
    expect(patch.body.code).toBe('JOURNAL_NOT_DRAFT');
    const del = await client.delete(`/api/v1/journal-entries/${journalId}`);
    expect(del.status).toBe(409);
  });

  it('reverses a posted journal with mirrored lines', async () => {
    const res = await client.post(`/api/v1/journal-entries/${journalId}/reverse`, {
      description: 'Cancel opening capital',
    });
    expect(res.status).toBe(200);
    expect(res.body.journal_type).toBe('reversal');
    expect(res.body.status).toBe('posted');
    expect(res.body.reversal_of_id).toBe(journalId);
    const debits = res.body.lines.map((l: { debit: string }) => l.debit).sort();
    const credits = res.body.lines.map((l: { credit: string }) => l.credit).sort();
    expect(debits).toEqual(['0', '2000']);
    expect(credits).toEqual(['0', '2000']);
    // Mirrored: original Dr 1100 / Cr 3010 -> reversal Dr 3010 / Cr 1100.
    const revLine = res.body.lines.find((l: { account_id: string }) => l.account_id === accounts.get('1100'));
    expect(revLine.credit).toBe('2000');
    const original = await client.get(`/api/v1/journal-entries/${journalId}`);
    expect(original.body.status).toBe('reversed');
  });

  it('rejects reversing a non-posted journal (422)', async () => {
    const created = await client.post('/api/v1/journal-entries', {
      company_id: companyId,
      posting_date: '2026-11-03',
      description: 'Draft to reverse',
      lines: [line('1100', '5', '0'), line('5210', '0', '5')],
    });
    const res = await client.post(`/api/v1/journal-entries/${created.body.id}/reverse`, {});
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('JOURNAL_NOT_POSTABLE');
  });

  it('rejects posting with a stale version (409 CONCURRENT_MODIFICATION)', async () => {
    const created = await client.post('/api/v1/journal-entries', {
      company_id: companyId,
      posting_date: '2026-11-03',
      description: 'Version check',
      lines: [line('1100', '50', '0'), line('5210', '0', '50')],
    });
    const id = created.body.id;
    await client.post(`/api/v1/journal-entries/${id}/submit`, {});
    await client.post(`/api/v1/journal-entries/${id}/approve`, {});
    const stale = await client.post(`/api/v1/journal-entries/${id}/post`, { version: 999 });
    expect(stale.status).toBe(409);
    expect(stale.body.code).toBe('CONCURRENT_MODIFICATION');
    const ok = await client.post(`/api/v1/journal-entries/${id}/post`, { version: 1 });
    expect(ok.status).toBe(200);
    expect(ok.body.status).toBe('posted');
  });

  it('honors the Idempotency-Key header: replay returns the same entry, never a duplicate', async () => {
    const body = {
      company_id: companyId,
      posting_date: '2026-11-03',
      description: 'Header idempotency',
      lines: [line('1100', '7', '0'), line('5210', '0', '7')],
    };
    const first = await client.post('/api/v1/journal-entries', body, { 'Idempotency-Key': 'e2e-hdr-key-0001' });
    expect(first.status).toBe(201);
    const replay = await client.post('/api/v1/journal-entries', body, { 'Idempotency-Key': 'e2e-hdr-key-0001' });
    expect(replay.body.id).toBe(first.body.id);
    const count = await prisma.journalEntry.count({ where: { description: 'Header idempotency' } });
    expect(count).toBe(1);
  });

  it('honors body idempotency_key: replay returns 200 with the same entry', async () => {
    const body = {
      company_id: companyId,
      posting_date: '2026-11-03',
      description: 'Body idempotency',
      lines: [line('1100', '8', '0'), line('5210', '0', '8')],
      idempotency_key: 'e2e-body-key-0001',
    };
    const first = await client.post('/api/v1/journal-entries', body);
    expect(first.status).toBe(201);
    const replay = await client.post('/api/v1/journal-entries', body);
    expect(replay.status).toBe(200);
    expect(replay.body.id).toBe(first.body.id);
    const count = await prisma.journalEntry.count({ where: { idempotencyKey: 'e2e-body-key-0001' } });
    expect(count).toBe(1);
  });

  it('enforces maker-checker when the company flag is on (403)', async () => {
    await prisma.company.update({ where: { id: companyId }, data: { makerCheckerJournal: true } });
    const created = await client.post('/api/v1/journal-entries', {
      company_id: companyId,
      posting_date: '2026-11-03',
      description: 'Maker checker',
      lines: [line('1100', '9', '0'), line('5210', '0', '9')],
    });
    const id = created.body.id;
    await client.post(`/api/v1/journal-entries/${id}/submit`, {});
    const denied = await client.post(`/api/v1/journal-entries/${id}/approve`, {});
    expect(denied.status).toBe(403);
    expect(denied.body.code).toBe('MAKER_CHECKER_VIOLATION');
    await prisma.company.update({ where: { id: companyId }, data: { makerCheckerJournal: false } });
    const allowed = await client.post(`/api/v1/journal-entries/${id}/approve`, {});
    expect(allowed.body.status).toBe('approved');
  });

  it('rejects posting into a closed period (423 PERIOD_CLOSED) and recovers on reopen', async () => {
    const periods = await client.get(`/api/v1/accounting-periods?fiscal_year_id=${(await client.get(`/api/v1/fiscal-years?company_id=${companyId}`)).body[0].id}`);
    const current = periods.body.find((p: { name: string }) => p.name === '2026-11');
    const closed = await client.post(`/api/v1/accounting-periods/${current.id}/close`, {});
    expect(closed.body.status).toBe('closed');

    const created = await client.post('/api/v1/journal-entries', {
      company_id: companyId,
      posting_date: '2026-11-03',
      description: 'Closed period',
      lines: [line('1100', '11', '0'), line('5210', '0', '11')],
    });
    const id = created.body.id;
    await client.post(`/api/v1/journal-entries/${id}/submit`, {});
    await client.post(`/api/v1/journal-entries/${id}/approve`, {});
    const blocked = await client.post(`/api/v1/journal-entries/${id}/post`, { version: 1 });
    expect(blocked.status).toBe(423);
    expect(blocked.body.code).toBe('PERIOD_CLOSED');

    const reopened = await client.post(`/api/v1/accounting-periods/${current.id}/reopen`, {});
    expect(reopened.body.status).toBe('open');
    expect(reopened.body.closed_by_id).toBeNull();
    const posted = await client.post(`/api/v1/journal-entries/${id}/post`, { version: 1 });
    expect(posted.status).toBe(200);
    expect(posted.body.status).toBe('posted');
  });

  it('rejects posting with no defined period (422 PERIOD_NOT_DEFINED)', async () => {
    const created = await client.post('/api/v1/journal-entries', {
      company_id: companyId,
      posting_date: '2027-06-15',
      description: 'No period',
      lines: [line('1100', '12', '0'), line('5210', '0', '12')],
    });
    const id = created.body.id;
    await client.post(`/api/v1/journal-entries/${id}/submit`, {});
    await client.post(`/api/v1/journal-entries/${id}/approve`, {});
    const res = await client.post(`/api/v1/journal-entries/${id}/post`, { version: 1 });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('PERIOD_NOT_DEFINED');
  });

  it('rejects deactivating an account with postings (409 ACCOUNT_HAS_POSTINGS)', async () => {
    const res = await client.post(`/api/v1/accounts/${accounts.get('1100')}/deactivate`, {});
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('ACCOUNT_HAS_POSTINGS');
    // A fresh account deactivates cleanly.
    const ok = await client.post(`/api/v1/accounts/${accounts.get('1120')}/deactivate`, {});
    expect(ok.status).toBe(200);
    expect(ok.body.is_active).toBe(false);
  });

  it('rejects flipping is_postable true->false when lines exist (422)', async () => {
    const res = await client.patch(`/api/v1/accounts/${accounts.get('1100')}`, { is_postable: false });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('ACCOUNT_HAS_POSTINGS');
  });

  it('produces a balanced trial balance that reconciles to posted lines', async () => {
    const tb = await client.get(
      `/api/v1/reports/trial-balance?company_id=${companyId}&from=2026-01-01&to=2026-12-31`,
    );
    expect(tb.status).toBe(200);
    expect(tb.body.balanced).toBe(true);
    expect(tb.body.total_debit).toBe(tb.body.total_credit);
    // Posted entries: reversal of J1 (Dr 3010 2000 / Cr 1100 2000),
    // J4 version-check (Dr 1100 50 / Cr 5210 50), J5 reopened (Dr 1100 11 / Cr 5210 11).
    // J1 itself is reversed -> excluded.
    const tbLines = tb.body.lines as Array<{ code: string; total_debit: string; total_credit: string }>;
    const byCode = new Map(tbLines.map((l) => [l.code, l] as const));
    expect(byCode.get('1100')!.total_debit).toBe('61.00');
    expect(byCode.get('1100')!.total_credit).toBe('2000.00');
    expect(byCode.get('3010')!.total_debit).toBe('2000.00');
    expect(byCode.get('3010')!.total_credit).toBe('0.00');
    expect(byCode.get('5210')!.total_debit).toBe('0.00');
    expect(byCode.get('5210')!.total_credit).toBe('61.00');
    expect(tb.body.total_debit).toBe('2061.00');
    expect(tb.body.total_credit).toBe('2061.00');
    // Reconcile against raw posted lines.
    const agg = await prisma.$queryRaw<Array<{ d: string; c: string }>>`
      SELECT SUM(l.debit)::text AS d, SUM(l.credit)::text AS c
      FROM journal_lines l JOIN journal_entries e ON e.id = l.journal_entry_id
      WHERE e.company_id = ${companyId}::uuid AND e.status = 'posted'`;
    expect(`${Number(agg[0].d).toFixed(2)}`).toBe(tb.body.total_debit);
    expect(`${Number(agg[0].c).toFixed(2)}`).toBe(tb.body.total_credit);
  });

  it('seeds standard tax codes idempotently (14% input/output)', async () => {
    const first = await client.post(`/api/v1/companies/${companyId}/tax-codes/seed-standard`, {});
    expect(first.status).toBe(201);
    expect(first.body.created).toHaveLength(2);
    expect(first.body.note).toBeDefined();
    const second = await client.post(`/api/v1/companies/${companyId}/tax-codes/seed-standard`, {});
    expect(second.body.created).toHaveLength(0);
    expect(second.body.skipped).toHaveLength(2);
    const list = await client.get(`/api/v1/tax-codes?company_id=${companyId}`);
    expect(list.body).toHaveLength(2);
    const input = list.body.find((t: { type: string }) => t.type === 'input');
    expect(input.rate).toBe('14');
    expect(input.tax_account.code).toBe('1230');
    const output = list.body.find((t: { type: string }) => t.type === 'output');
    expect(output.tax_account.code).toBe('2120');
  });

  it('lists journal entries with pagination, filters and computed totals', async () => {
    const res = await client.get(
      `/api/v1/journal-entries?company_id=${companyId}&status=posted&per_page=5`,
    );
    expect(res.status).toBe(200);
    expect(res.body.meta.total).toBeGreaterThanOrEqual(3);
    expect(res.body.data.length).toBeLessThanOrEqual(5);
    for (const e of res.body.data) {
      expect(e.total_debit).toBe(e.total_credit);
      expect(e.lines.length).toBeGreaterThanOrEqual(2);
    }
  });
});
