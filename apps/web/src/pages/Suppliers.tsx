import { PartyDetailPage, PartyListPage } from "./PartyShared";

export function SuppliersPage() {
  return <PartyListPage resource="suppliers" />;
}

export function SupplierDetailPage() {
  return <PartyDetailPage resource="suppliers" />;
}
