import { getFitnessboardStatus } from "@/lib/actions/fitnessboard-setup";
import { FitnessboardSetupForm } from "./form";

export const dynamic = "force-dynamic";

export default async function FitnessboardIntegrationPage() {
  const status = await getFitnessboardStatus();

  return (
    <div className="container max-w-2xl py-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">FitnessBoard v3 Sync</h1>
        <p className="text-muted-foreground mt-2">
          Mirror member, plan, and payment data from the legacy{" "}
          <a
            className="underline"
            href="https://v3.fitnessboard.in"
            target="_blank"
            rel="noopener noreferrer"
          >
            v3.fitnessboard.in
          </a>{" "}
          dashboard into TraqGym nightly. Use this during the side-by-side
          migration window; once everything reconciles, the sync can be turned
          off and v3 retired.
        </p>
      </div>

      <div className="rounded-lg border bg-card p-6">
        <h2 className="font-semibold mb-3">How it works</h2>
        <ol className="space-y-2 text-sm list-decimal pl-5">
          <li>
            Save the v3 mobile + password below. The password is encrypted at
            rest (AES-256-GCM via <code className="rounded bg-muted px-1.5 py-0.5">DATA_ENCRYPTION_KEY</code>).
          </li>
          <li>
            A GitHub Actions cron runs nightly at <strong>02:30 IST</strong>{" "}
            (21:00 UTC) and pulls the credentials over an authenticated internal API.
          </li>
          <li>
            The runner logs into v3, fetches members / payments / memberships /
            balance, and POSTs them back to this gym&apos;s internal API. The
            API upserts rows into Postgres using stable v3 keys (
            <code className="rounded bg-muted px-1.5 py-0.5">BillNo</code> for
            payments, <code className="rounded bg-muted px-1.5 py-0.5">MemberId</code>{" "}
            for members).
          </li>
          <li>
            Last-sync status is shown below — green = success, amber = queued,
            red = failure.
          </li>
        </ol>
      </div>

      <FitnessboardSetupForm initialStatus={status} />
    </div>
  );
}
