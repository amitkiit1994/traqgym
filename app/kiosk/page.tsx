// Server-component wrapper so we can opt out of static prerender.
// The actual UI lives in kiosk-client.tsx as a client component.
import KioskClient from "./kiosk-client";

export const dynamic = "force-dynamic";

export default function KioskPage() {
  return <KioskClient />;
}
