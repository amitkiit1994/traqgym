import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "TraqGym - AI-Native Gym Management Software",
  description:
    "The AI-native gym management platform. Members, billing, attendance, notifications — managed through natural language. Built for India.",
  metadataBase: new URL("https://traqgym.com"),
  openGraph: {
    title: "TraqGym - AI-Native Gym Management Software",
    description: "Manage your gym with AI. Members, billing, attendance, WhatsApp reminders — all through natural language.",
    url: "https://traqgym.com",
    siteName: "TraqGym",
    type: "website",
    locale: "en_IN",
    images: [
      {
        url: "/og-image.png",
        width: 1200,
        height: 630,
        alt: "TraqGym - AI-Native Gym Management",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "TraqGym - AI-Native Gym Management Software",
    description: "Manage your gym with AI. Members, billing, attendance, WhatsApp reminders — all through natural language.",
    images: ["/og-image.png"],
  },
  alternates: {
    canonical: "https://traqgym.com",
  },
  keywords: ["gym management software", "gym software india", "ai gym management", "fitness center software", "gym billing software", "gym attendance system", "gym crm"],
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
              description: "AI-native gym management platform. Members, billing, attendance, notifications — managed through natural language.",
              url: "https://traqgym.com",
              offers: {
                "@type": "Offer",
                price: "4999",
                priceCurrency: "INR",
                priceValidUntil: "2027-12-31",
              },
              aggregateRating: {
                "@type": "AggregateRating",
                ratingValue: "4.4",
                reviewCount: "2",
              },
            }),
          }}
        />
      </head>
      <body className="bg-[#09090b] text-[#fafafa] antialiased">{children}</body>
    </html>
  );
}
