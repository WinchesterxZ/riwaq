/**
 * E2E test helpers: spins up the real Nest app against the isolated test DB
 * and provides a CSRF-aware test client.
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ThrottlerGuard } from '@nestjs/throttler';
import request from 'supertest';
import type { Response, Test as SuperTest } from 'supertest';
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { AppModule } from '../src/app.module';

type Agent = ReturnType<typeof request.agent>;

if (existsSync('.env')) loadEnvFile('.env');
export const TEST_DB_URL = process.env.TEST_DATABASE_URL ?? '';

/** Rebuilds the test DB from empty (schema dump + seed). Never touches dev. */
export function resetTestDb() {
  if (!TEST_DB_URL || new URL(TEST_DB_URL).pathname !== '/atlas_erp_test' ||
      !['localhost', '127.0.0.1', '[::1]'].includes(new URL(TEST_DB_URL).hostname)) {
    throw new Error('TEST_DATABASE_URL must point to the local dedicated atlas_erp_test database');
  }
  const env = {
    ...process.env,
    DATABASE_URL: TEST_DB_URL,
    PRISMA_ENGINES_CHECKSUM_IGNORE_MISSING: '1',
    CHECKPOINT_DISABLE: '1',
  };
  execSync('corepack pnpm exec prisma db execute --stdin --schema prisma/schema.prisma', {
    cwd: __dirname + '/..', env, input: 'DROP SCHEMA public CASCADE; CREATE SCHEMA public;', stdio: ['pipe', 'pipe', 'pipe'],
  });
  execSync('corepack pnpm exec prisma db execute --file test/schema-dump.sql --schema prisma/schema.prisma', {
    cwd: __dirname + '/..', env, stdio: 'pipe',
  });
  execSync('corepack pnpm exec tsx prisma/seed.ts', {
    cwd: __dirname + '/..',
    env,
    stdio: 'pipe',
  });
}

function csrfFromSetCookie(setCookie: string | string[] | undefined): string | null {
  if (!setCookie) return null;
  const list = Array.isArray(setCookie) ? setCookie : [setCookie];
  for (const c of list) {
    const m = c.match(/^atlas_csrf=([^;]+)/);
    if (m) return decodeURIComponent(m[1]);
  }
  return null;
}

export class TestClient {
  agent: Agent;
  csrfToken: string | null = null;
  orgId: string | null = null;

  constructor(agent: Agent) {
    this.agent = agent;
  }

  async initCsrf() {
    const res = await this.agent.get('/api/v1/auth/csrf');
    this.csrfToken = res.body.csrfToken;
  }

  private headers(extra: Record<string, string> = {}) {
    const h: Record<string, string> = { ...extra };
    if (this.orgId) h['X-Organization-Id'] = this.orgId;
    return h;
  }

  private withCsrf(req: SuperTest) {
    if (this.csrfToken) req.set('X-CSRF-Token', this.csrfToken);
    return req;
  }

  async post(path: string, body: object, extraHeaders: Record<string, string> = {}) {
    const res = await this.withCsrf(
      this.agent.post(path).set(this.headers(extraHeaders)).send(body),
    );
    const fresh = csrfFromSetCookie(res.headers['set-cookie']);
    if (fresh) this.csrfToken = fresh;
    return res;
  }

  async get(path: string, extraHeaders: Record<string, string> = {}) {
    return this.agent.get(path).set(this.headers(extraHeaders));
  }

  async patch(path: string, body: object, extraHeaders: Record<string, string> = {}) {
    return this.withCsrf(this.agent.patch(path).set(this.headers(extraHeaders)).send(body));
  }

  async delete(path: string, extraHeaders: Record<string, string> = {}) {
    return this.withCsrf(this.agent.delete(path).set(this.headers(extraHeaders)));
  }

  async login(email: string, password: string, totpCode?: string) {
    const res = await this.post('/api/v1/auth/login', { email, password, totpCode });
    return res;
  }
}

export async function createTestApp(): Promise<{
  app: INestApplication;
  client: TestClient;
}> {
  process.env.DATABASE_URL = TEST_DB_URL;
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    // Rate limiting is verified manually against the dev server; disabled here
    // so lockout tests (many rapid logins) don't trip the throttle.
    .overrideGuard(ThrottlerGuard)
    .useValue({ canActivate: () => true })
    .compile();
  const app = moduleRef.createNestApplication();
  app.setGlobalPrefix('api/v1', { exclude: ['health', 'ready'] });
  const cookieParser = (await import('cookie-parser')).default;
  app.use(cookieParser());
  await app.init();
  const agent = request.agent(app.getHttpServer());
  const client = new TestClient(agent);
  await client.initCsrf();
  return { app, client };
}
