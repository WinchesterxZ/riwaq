/** Request-scoped identity set by guards. */
export interface RequestUser {
  id: string;
  email: string;
  name: string;
  mfaEnabled: boolean;
}

export interface OrgContext {
  organizationId: string;
  membershipId: string;
  /** null = access to all companies in the org */
  companyIds: string[] | null;
  /** null = access to all branches in the org */
  branchIds: string[] | null;
  roles: string[];
  permissions: string[];
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      correlationId: string;
      user?: RequestUser;
      orgContext?: OrgContext;
    }
  }
}
