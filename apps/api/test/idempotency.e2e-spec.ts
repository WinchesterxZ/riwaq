/**
 * E2E: idempotent POST replay — retrying with the same Idempotency-Key
 * returns the original response instead of creating a duplicate.
 */
import { INestApplication } from '@nestjs/common';
import { createTestApp, TestClient, TEST_DB_URL, resetTestDb } from './helpers';
import { PrismaClient } from '@prisma/client';
import { randomBytes } from 'node:crypto';

const prisma = new PrismaClient({ datasourceUrl: TEST_DB_URL });

describe('Idempotency (e2e)', () => {
  let app: INestApplication;
  let client: TestClient;
  let orgId: string;

  beforeAll(async () => {
    resetTestDb();
    ({ app, client } = await createTestApp());
    const first = await client.post('/api/v1/auth/first-run', {
      organizationName: 'Idem Org',
      organizationNameAr: 'منظمة التكرار',
      adminName: 'Idem Admin',
      adminEmail: 'idem@atlas.test',
      password: 'idempotent-123',
    });
    expect(first.status).toBe(201);
    orgId = first.body.organization.id;
    client.orgId = orgId;
  }, 60000);

  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  });

  it('replays the original company instead of creating a duplicate', async () => {
    const key = `idem-${randomBytes(8).toString('hex')}`;
    const payload = {
      organizationId: orgId,
      name: 'Idem Company',
      nameAr: 'شركة التكرار',
      baseCurrency: 'EGP',
    };

    const first = await client.post('/api/v1/companies', payload, {
      'Idempotency-Key': key,
    });
    expect(first.status).toBe(201);
    const companyId = first.body.id;

    const replay = await client.post('/api/v1/companies', payload, {
      'Idempotency-Key': key,
    });
    expect(replay.status).toBe(201);
    expect(replay.body.id).toBe(companyId);

    const count = await prisma.company.count({
      where: { organizationId: orgId, name: 'Idem Company' },
    });
    expect(count).toBe(1);
  });

  it('different keys create different companies', async () => {
    const mk = () => `idem-${randomBytes(8).toString('hex')}`;
    const payload = (n: string) => ({
      organizationId: orgId,
      name: n,
      nameAr: 'شركة',
      baseCurrency: 'EGP',
    });
    const a = await client.post('/api/v1/companies', payload('Company One'), { 'Idempotency-Key': mk() });
    const b = await client.post('/api/v1/companies', payload('Company Two'), { 'Idempotency-Key': mk() });
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    expect(a.body.id).not.toBe(b.body.id);
  });
});
