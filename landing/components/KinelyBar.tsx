// Kinely ecosystem bar — shared across TraqGym / FreeForm Fitness / SquatSense sites.
// Self-contained (inline styles, no Tailwind/theme deps) so it renders identically everywhere.
const PRODUCTS = [
  { id: "traqgym", href: "https://traqgym.com", label: "TraqGym", note: "runs the gym", accent: "#8B5CF6" },
  { id: "freeform", href: "https://www.freeformfitness.ai", label: "FreeForm Fitness", note: "coaches the body", accent: "#FF4438" },
  { id: "squatsense", href: "https://www.squatsense.ai", label: "SquatSense", note: "fills the floor", accent: "#A3E635" },
] as const;

export default function KinelyBar({ current }: { current: "traqgym" | "freeform" | "squatsense" }) {
  return (
    <footer
      aria-label="Kinely ecosystem"
      style={{ background: "#0B0B0F", borderTop: "1px solid rgba(255,255,255,.09)", padding: "26px 20px", fontFamily: "Inter, system-ui, -apple-system, sans-serif" }}
    >
      <div style={{ maxWidth: 1120, margin: "0 auto", display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 18 }}>
        <a href="https://kinely.ai" style={{ display: "inline-flex", alignItems: "center", gap: 9, textDecoration: "none" }}>
          <span aria-hidden style={{ width: 11, height: 11, borderRadius: 3, background: "linear-gradient(135deg,#FF4438,#FF8A3D)", transform: "rotate(12deg)", display: "inline-block" }} />
          <span style={{ fontWeight: 800, fontSize: 17, letterSpacing: "-0.02em", color: "#fff" }}>
            Kine<span style={{ color: "#FF4438" }}>ly</span>
          </span>
          <span style={{ fontSize: 12, color: "#9CA3AF" }}>· the AI operating system for fitness</span>
        </a>
        <nav style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 18, fontSize: 13, lineHeight: 1.4 }}>
          {PRODUCTS.map((p) =>
            p.id === current ? (
              <span key={p.id} style={{ color: "#fff", fontWeight: 600 }}>
                <span aria-hidden style={{ display: "inline-block", width: 7, height: 7, borderRadius: "50%", background: p.accent, marginRight: 6, verticalAlign: "1px" }} />
                {p.label}
              </span>
            ) : (
              <a key={p.id} href={p.href} style={{ color: "#9CA3AF", textDecoration: "none" }}>
                <span aria-hidden style={{ display: "inline-block", width: 7, height: 7, borderRadius: "50%", background: p.accent, marginRight: 6, verticalAlign: "1px", opacity: 0.85 }} />
                {p.label}
              </a>
            )
          )}
          <a href="https://kinely.ai/app" style={{ color: "#9CA3AF", textDecoration: "none" }}>Live demo</a>
          <a href="https://kinely.ai/invest" style={{ color: "#FF6B4A", textDecoration: "none", fontWeight: 700 }}>Invest →</a>
        </nav>
      </div>
    </footer>
  );
}
