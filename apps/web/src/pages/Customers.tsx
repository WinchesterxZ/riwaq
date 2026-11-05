import { PartyDetailPage, PartyListPage } from "./PartyShared";

export function CustomersPage() {
  return <PartyListPage resource="customers" />;
}

export function CustomerDetailPage() {
  return <PartyDetailPage resource="customers" />;
}
