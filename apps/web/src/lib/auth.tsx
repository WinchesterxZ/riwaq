import { ApiError, type Membership, type User } from "@atlas-erp/api-client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { api, persistScope, restoreScope } from "./api";

interface AuthContextValue {
  user: User | null;
  memberships: Membership[];
  orgId?: string;
  companyId?: string;
  setOrg: (id?: string) => void;
  setCompany: (id?: string) => void;
  permissions: Set<string>;
  hasPermission: (perm: string) => boolean;
  isLoading: boolean;
  isAuthed: boolean;
  authFailed: boolean;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const [scope, setScope] = useState<{ orgId?: string; companyId?: string }>(() => restoreScope());

  const meQuery = useQuery({
    queryKey: ["me"],
    queryFn: () => api.me(),
    retry: false,
  });

  const authed = meQuery.status === "success";
  const authFailed =
    meQuery.status === "error" &&
    meQuery.error instanceof ApiError &&
    meQuery.error.httpStatus === 401;

  const user: User | null = authed ? meQuery.data.user : null;
  const memberships: Membership[] = authed ? meQuery.data.memberships : [];

  // Default to the first membership's org when nothing is selected yet.
  useEffect(() => {
    if (authed && !scope.orgId && memberships.length > 0) {
      const first = memberships[0].organizationId;
      persistScope(first, undefined);
      setScope({ orgId: first, companyId: undefined });
    }
  }, [authed, scope.orgId, memberships]);

  // If the selected org is no longer in memberships, fall back.
  useEffect(() => {
    if (authed && scope.orgId && !memberships.some((m) => m.organizationId === scope.orgId)) {
      const fallback = memberships[0]?.organizationId;
      persistScope(fallback, undefined);
      setScope({ orgId: fallback, companyId: undefined });
    }
  }, [authed, scope.orgId, memberships]);

  const rolesQuery = useQuery({
    queryKey: ["roles", scope.orgId],
    queryFn: () => api.listRoles(),
    enabled: authed && !!scope.orgId,
    retry: false,
  });

  const permissions = useMemo(() => {
    const set = new Set<string>();
    if (!scope.orgId || !rolesQuery.data) return set;
    const membership = memberships.find((m) => m.organizationId === scope.orgId);
    if (!membership) return set;
    // /auth/me returns role NAMES; match them against the org's role catalog.
    const roleNames = new Set(membership.roles);
    for (const role of rolesQuery.data) {
      if (roleNames.has(role.name)) {
        for (const p of role.permissions) set.add(p);
      }
    }
    return set;
  }, [rolesQuery.data, memberships, scope.orgId]);

  const setOrg = useCallback(
    (id?: string) => {
      persistScope(id, undefined);
      setScope({ orgId: id, companyId: undefined });
      void qc.invalidateQueries();
    },
    [qc],
  );

  const setCompany = useCallback(
    (id?: string) => {
      persistScope(scope.orgId, id);
      setScope((s) => ({ ...s, companyId: id }));
      void qc.invalidateQueries();
    },
    [qc, scope.orgId],
  );

  const logout = useCallback(async () => {
    try {
      await api.logout();
    } catch {
      // Even if the server call fails, drop local state.
    }
    await qc.clear();
    setScope({ orgId: undefined, companyId: undefined });
  }, [qc]);

  const refresh = useCallback(async () => {
    await meQuery.refetch();
    if (scope.orgId) await rolesQuery.refetch();
  }, [meQuery, rolesQuery, scope.orgId]);

  const value: AuthContextValue = {
    user,
    memberships,
    orgId: scope.orgId,
    companyId: scope.companyId,
    setOrg,
    setCompany,
    permissions,
    hasPermission: useCallback((p: string) => permissions.has(p), [permissions]),
    isLoading: meQuery.isLoading || (authed && memberships.length > 0 && (!scope.orgId || rolesQuery.isLoading)),
    isAuthed: authed && !rolesQuery.isError,
    authFailed,
    logout,
    refresh,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
