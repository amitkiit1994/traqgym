import { redirect } from "next/navigation";
import { requireWorker } from "@/lib/auth-guard";
import { getPayments, getPaymentModes, getPaymentCollectors } from "@/lib/actions/payments";
import { getLocations } from "@/lib/actions/locations";
import { PaymentsClient } from "./payments-client";

export const dynamic = "force-dynamic";

type SearchParams = {
  from?: string;
  to?: string;
  mode?: string;
  locationId?: string;
  collectedById?: string;
  q?: string;
  page?: string;
};

export default async function PaymentsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  try {
    await requireWorker();
  } catch {
    redirect("/login");
  }

  const sp = await searchParams;

  // Default: last 30 days inclusive of today
  const today = new Date();
  const defaultTo = today.toISOString().split("T")[0];
  const defaultFromDate = new Date(today);
  defaultFromDate.setDate(defaultFromDate.getDate() - 29);
  const defaultFrom = defaultFromDate.toISOString().split("T")[0];

  const filters = {
    from: sp.from || defaultFrom,
    to: sp.to || defaultTo,
    mode: sp.mode || "",
    locationId: sp.locationId ? Number(sp.locationId) : undefined,
    collectedById: sp.collectedById ? Number(sp.collectedById) : undefined,
    q: sp.q || "",
    page: sp.page ? Number(sp.page) : 1,
  };

  const [result, modes, collectors, locations] = await Promise.all([
    getPayments(filters),
    getPaymentModes(),
    getPaymentCollectors(),
    getLocations(),
  ]);

  return (
    <PaymentsClient
      initial={result}
      filters={filters}
      modes={modes}
      collectors={collectors}
      locations={locations.map((l) => ({ id: l.id, name: l.name }))}
    />
  );
}
