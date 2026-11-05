import { AtlasApiClient } from "@atlas-erp/api-client";

const baseUrl =
  (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, "") ||
  `http://${window.location.hostname === "127.0.0.1" ? "127.0.0.1" : "localhost"}:3000`;

export const api = new AtlasApiClient({ baseUrl });

/** Restore persisted org/company scope into the client context. */
export function restoreScope(): { orgId?: string; companyId?: string } {
  const orgId = localStorage.getItem("atlas.orgId") || undefined;
  const companyId = localStorage.getItem("atlas.companyId") || undefined;
  api.setOrganizationId(orgId);
  api.setCompanyId(companyId);
  return { orgId, companyId };
}

export function persistScope(orgId?: string, companyId?: string): void {
  if (orgId) localStorage.setItem("atlas.orgId", orgId);
  else localStorage.removeItem("atlas.orgId");
  if (companyId) localStorage.setItem("atlas.companyId", companyId);
  else localStorage.removeItem("atlas.companyId");
  api.setOrganizationId(orgId);
  api.setCompanyId(companyId);
}
