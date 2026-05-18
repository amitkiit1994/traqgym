import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import { SessionProvider } from "@/components/session-provider";
import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "sonner";
import "@/lib/types";
import "./globals.css";

const inter = Inter({
  variable: "--font-sans",
  subsets: ["latin"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const gymName = process.env.NEXT_PUBLIC_GYM_NAME || "TraqGym";

// Brand hue is injected as a CSS variable on :root at request time so the
// same byte-identical CSS bundle serves FFF (default 275 / purple) and
// EGYM (25 / red) — each Vercel project sets NEXT_PUBLIC_GYM_THEME_HUE
// to the desired OKLCh hue degree. Validated as a finite number 0-360
// so a bad env var can't inject arbitrary CSS.
const rawBrandHue = Number(process.env.NEXT_PUBLIC_GYM_THEME_HUE);
const brandHue =
  Number.isFinite(rawBrandHue) && rawBrandHue >= 0 && rawBrandHue <= 360
    ? rawBrandHue
    : 275;

export const metadata: Metadata = {
  title: {
    default: gymName,
    template: `%s | ${gymName}`,
  },
  description: `${gymName} — powered by TraqGym`,
  robots: {
    index: false,
    follow: false,
  },
  other: { "theme-color": "#09090b" },
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: gymName,
  },
  icons: {
    apple: "/icons/icon-192.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${inter.variable} ${jetbrainsMono.variable} h-full antialiased`}
      style={{ ["--brand-hue" as string]: String(brandHue) }}
    >
      <body className="min-h-full flex flex-col overflow-x-hidden">
        <ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false}>
          <SessionProvider>{children}</SessionProvider>
          <Toaster richColors position="top-right" />
        </ThemeProvider>
      </body>
    </html>
  );
}
