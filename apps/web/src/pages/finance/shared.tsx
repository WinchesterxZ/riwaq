import { useTranslation } from "react-i18next";
import { Card, EmptyState, PageHeader } from "../../components/ui";
import { useAuth } from "../../lib/auth";

/** Permission + company guard mirroring the purchasing/shared PurchaseGuard. */
export function FinanceGuard({
  perm,
  title,
  subtitle,
  actions,
  children,
}: {
  perm: string;
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  const { t } = useTranslation();
  const { companyId, hasPermission } = useAuth();
  const canView = hasPermission(perm);
  return (
    <>
      <PageHeader title={title} subtitle={subtitle} actions={actions} />
      {!canView ? (
        <Card>
          <EmptyState title={t("common.noPermission")} />
        </Card>
      ) : !companyId ? (
        <Card>
          <EmptyState title={t("common.selectCompany")} />
        </Card>
      ) : (
        children
      )}
    </>
  );
}
