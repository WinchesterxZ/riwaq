/**
 * E2E: cross-organization isolation (IDOR/BOLA negative test).
 * User A (org 1) must NOT access org 2's data by swapping X-Organization-Id.
 * Denials are audit-logged server-side.
 */
import { INestApplication } from '@nestjs/common';
import * as argon2 from 'argon2';
import { createTestApp, TestClient, TEST_DB_URL, resetTestDb } from './helpers';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient({ datasourceUrl: TEST_DB_URL });

describe('Cross-organization isolation (e2e)', () => {
  let orgA: string;
  let orgB: string;

  beforeAll(async () => {
    resetTestDb();
    // Org A via first-run (user A becomes its owner).
    const boot = await createTestApp();
    const first = await boot.client.post('/api/v1/auth/first-run', {
      organizationName: 'Org A',
      organizationNameAr: 'منظمة أ',
      adminName: 'Admin A',
      adminEmail: 'admin-a@atlas.test',
      password: 'password-a-123',
    });
    expect(first.status).toBe(201);
    orgA = first.body.organization.id;
    await boot.app.close();

    // User B is a stranger: no membership anywhere. They create org B.
    await prisma.user.create({
      data: {
        email: 'admin-b@atlas.test',
        passwordHash: await argon2.hash('password-b-123', { type: argon2.argon2id }),
        name: 'Admin B',
        status: 'active',
      },
    });
    const bootB = await createTestApp();
    const loginB = await bootB.client.login('admin-b@atlas.test', 'password-b-123');
    expect(loginB.status).toBe(200);
    const orgRes = await bootB.client.post('/api/v1/organizations', {
      name: 'Org B',
      nameAr: 'منظمة ب',
      defaultCurrency: 'EGP',
      defaultTimezone: 'Africa/Cairo',
    });
    expect(orgRes.status).toBe(201);
    orgB = orgRes.body.id;
    await bootB.app.close();
  }, 60000);

  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function loginAsA(): Promise<{ app: INestApplication; client: TestClient }> {
    const { app, client } = await createTestApp();
    const login = await client.login('admin-a@atlas.test', 'password-a-123');
    expect(login.status).toBe(200);
    return { app, client };
  }

  it('rejects reading org B with user A credentials (403 + audit)', async () => {
    const { app, client } = await loginAsA();
    try {
      client.orgId = orgB; // attacker swaps the header
      const res = await client.get('/api/v1/companies');
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('NOT_ORGANIZATION_MEMBER');

      const events = await prisma.auditEvent.findMany({
        where: { action: 'security.cross_org_denied', organizationId: orgB },
        orderBy: { createdAt: 'desc' },
        take: 1,
      });
      expect(events.length).toBe(1);
      expect(events[0].entityId).toBe(orgB);
    } finally {
      await app.close();
    }
  });

  it('rejects org B dashboard with user A credentials', async () => {
    const { app, client } = await loginAsA();
    try {
      client.orgId = orgB;
      const res = await client.get('/api/v1/dashboard/summary');
      expect(res.status).toBe(403);
    } finally {
      await app.close();
    }
  });

  it('still allows user A inside their own org', async () => {
    const { app, client } = await loginAsA();
    try {
      client.orgId = orgA;
      const res = await client.get('/api/v1/dashboard/summary');
      expect(res.status).toBe(200);
      expect(res.body.users).toBeGreaterThan(0);
    } finally {
      await app.close();
    }
  });
});
