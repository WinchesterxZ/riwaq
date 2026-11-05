import { PasswordService } from './password.service';

describe('PasswordService (argon2id)', () => {
  const svc = new PasswordService();

  it('hashes and verifies the correct password', async () => {
    const hash = await svc.hash('a-strong-password-123');
    expect(hash).not.toContain('a-strong-password-123');
    expect(await svc.verify(hash, 'a-strong-password-123')).toBe(true);
  }, 15000);

  it('rejects the wrong password', async () => {
    const hash = await svc.hash('a-strong-password-123');
    expect(await svc.verify(hash, 'wrong-password')).toBe(false);
  }, 15000);

  it('returns false for a malformed hash instead of throwing', async () => {
    expect(await svc.verify('not-a-hash', 'whatever')).toBe(false);
  });

  it('produces different hashes for the same password (salting)', async () => {
    const a = await svc.hash('same-password-123');
    const b = await svc.hash('same-password-123');
    expect(a).not.toBe(b);
  }, 15000);
});
