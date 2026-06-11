import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "TraqGym - AI-Native, Chat-First Gym OS for India | A Kinely Product",
  description:
    "TraqGym is the AI-native, chat-first gym OS for India. Run members, billing, attendance, and renewals from Telegram — WhatsApp rolling out. Live at eGym Lokhandwala, Mumbai, our first paying customer. A Kinely product.",
  metadataBase: new URL("https://traqgym.com"),
  openGraph: {
    title: "TraqGym - AI-Native, Chat-First Gym OS for India",
    description: "Run your gym from chat — Telegram live, WhatsApp rolling out. Live at eGym Lokhandwala, Mumbai. A Kinely product.",
    url: "https://traqgym.com",
    siteName: "TraqGym",
    type: "website",
    locale: "en_IN",
    images: [
      {
        url: "/og-image.png",
        width: 1200,
        height: 630,
        alt: "TraqGym - AI-Native, Chat-First Gym OS",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "TraqGym - AI-Native, Chat-First Gym OS for India",
    description: "Run your gym from chat — Telegram live, WhatsApp rolling out. Live at eGym Lokhandwala, Mumbai. A Kinely product.",
    images: ["/og-image.png"],
  },
  alternates: {
    canonical: "https://traqgym.com",
  },
  keywords: ["gym management software", "gym software india", "ai gym management", "chat-first gym os", "telegram gym management", "fitness center software", "gym billing software", "gym attendance system", "gym crm", "kinely"],
  robots: {
    index: true,
    follow: true,
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <head>
        <link rel="icon" href="/favicon.ico" sizes="any" />
        <link rel="icon" href="/favicon.png" type="image/png" />
        <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
        <meta name="theme-color" content="#050507" />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              "@context": "https://schema.org",
              "@type": "SoftwareApplication",
              name: "TraqGym",
              applicationCategory: "BusinessApplication",
              operatingSystem: "Web",
              description: "AI-native, chat-first gym OS for India. Members, billing, attendance, and renewals managed from chat — Telegram live, WhatsApp rolling out. A Kinely product.",
              url: "https://traqgym.com",
              brand: {
                "@type": "Brand",
                name: "Kinely",
                url: "https://kinely.ai",
              },
              offers: {
                "@type": "Offer",
                price: "3999",
                priceCurrency: "INR",
                priceValidUntil: "2027-12-31",
                url: "https://traqgym.kinely.ai/pricing",
              },
            }),
          }}
        />
      </head>
      <body className="bg-[#09090b] text-[#fafafa] antialiased">{children}</body>
    </html>
  );
}
