import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "TraqGym - AI-Native Gym Management Software",
  description:
    "The AI-native gym management platform. Members, billing, attendance, notifications — managed through natural language. Built for India.",
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
      </head>
      <body className="bg-[#09090b] text-[#fafafa] antialiased">{children}</body>
    </html>
  );
}
