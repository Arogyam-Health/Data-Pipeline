import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Data Pipeline Server",
  description: "Scalable data pipeline for Shiprocket, Shopify, Meta Ads, and more",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
