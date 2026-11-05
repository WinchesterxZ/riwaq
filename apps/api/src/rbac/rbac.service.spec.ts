import { RbacService } from './rbac.service';

describe('RbacService (pure permission evaluation)', () => {
  describe('grantsAll', () => {
    it('grants when all required permissions are present', () => {
      expect(
        RbacService.grantsAll(['users:view', 'users:manage'], ['users:view']),
      ).toBe(true);
    });

    it('denies when any required permission is missing', () => {
      expect(
        RbacService.grantsAll(['users:view'], ['users:view', 'users:manage']),
      ).toBe(false);
    });

    it('denies an empty grant set', () => {
      expect(RbacService.grantsAll([], ['users:view'])).toBe(false);
    });

    it('passes with no required permissions', () => {
      expect(RbacService.grantsAll([], [])).toBe(true);
    });

    it('is exact-match (no prefix tricks)', () => {
      expect(RbacService.grantsAll(['user:view'], ['users:view'])).toBe(false);
    });
  });

  describe('mergePermissions', () => {
    it('deduplicates across roles', () => {
      const merged = RbacService.mergePermissions([
        ['users:view', 'users:manage'],
        ['users:view', 'roles:view'],
      ]);
      expect(merged.sort()).toEqual(['roles:view', 'users:manage', 'users:view']);
    });
  });
});
