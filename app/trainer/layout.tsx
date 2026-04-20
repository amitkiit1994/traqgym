import { redirect } from "next/navigation";
import { requireTrainer } from "@/lib/auth-guard";
import { TrainerNav } from "@/components/trainer-nav";

export default async function TrainerLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  let trainer: { workerId: number; name: string };
  try {
    trainer = await requireTrainer();
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unauthorized";
    if (message === "Not a trainer") {
      // Worker exists but has no PT packages — bounce to admin dashboard.
      redirect("/admin/dashboard");
    }
    redirect("/login");
  }

  return (
    <div className="min-h-screen flex flex-col">
      <TrainerNav trainerName={trainer.name} />
      <main className="flex-1 overflow-x-hidden">{children}</main>
    </div>
  );
}
