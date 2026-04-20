// Standalone layout — no admin chrome, no theme provider styling.
// Inherits the root <html><body> from app/layout.tsx.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default function PosterLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
