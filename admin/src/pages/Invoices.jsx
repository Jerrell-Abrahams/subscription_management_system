import { InvoicesCard } from '../components/InvoicesCard';

// The whole invoice book. Same card as the subscription page, minus the subscriptionId --
// so every action (generate, mark paid, void, download) works here without a second copy
// of those four modals living in this file.
export function Invoices() {
  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold text-text-h">Invoices</h2>
      <InvoicesCard />
    </div>
  );
}
