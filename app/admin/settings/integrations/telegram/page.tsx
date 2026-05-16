import { getSetupStatus } from "@/lib/actions/telegram-setup";
import { TelegramSetupForm } from "./form";

export const dynamic = "force-dynamic";

export default async function TelegramIntegrationPage() {
  const status = await getSetupStatus();

  return (
    <div className="container max-w-2xl py-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Telegram Bot Integration</h1>
        <p className="text-muted-foreground mt-2">
          Connect a Telegram bot so the gym owner can chat with TraqGym AI
          (member lookups, daily briefings, renewals).
        </p>
      </div>

      <div className="rounded-lg border bg-card p-6">
        <h2 className="font-semibold mb-3">How to set up</h2>
        <ol className="space-y-2 text-sm list-decimal pl-5">
          <li>
            Open <a className="underline" href="https://t.me/BotFather" target="_blank" rel="noopener noreferrer">@BotFather</a> on Telegram
          </li>
          <li>
            Send <code className="rounded bg-muted px-1.5 py-0.5">/newbot</code> and follow the prompts. Name it something like &quot;Free Form Fitness AI&quot;.
          </li>
          <li>
            Copy the bot token (looks like <code className="rounded bg-muted px-1.5 py-0.5">123456789:ABC...</code>) and paste below.
          </li>
          <li>
            Click <strong>Connect Bot</strong>. We&apos;ll validate, save, and register the webhook automatically.
          </li>
          <li>
            Open the bot in Telegram (it will show a t.me link after connect), send <code className="rounded bg-muted px-1.5 py-0.5">/pair {"{code}"}</code> using the code shown below.
          </li>
        </ol>
      </div>

      <TelegramSetupForm initialStatus={status} />
    </div>
  );
}
