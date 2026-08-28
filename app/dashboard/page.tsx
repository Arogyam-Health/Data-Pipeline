"use client";

import Link from "next/link";

const SOURCES = [
  {
    href: "/dashboard/shiprocket",
    title: "Shiprocket",
    body: "Orders, scans, Shopify enrichment, remittance/UTR, filters, and data quality.",
  },
  {
    href: "/dashboard/shopify",
    title: "Shopify",
    body: "Orders, products, UTM attribution, and sync health.",
  },
  {
    href: "/dashboard/meta",
    title: "Meta Ads",
    body: "Ad-level daily insights, funnel, and sync health.",
  },
  {
    href: "/dashboard/ga4",
    title: "GA4",
    body: "Daily, channel, and UTM analytics plus sync health.",
  },
];

export default function GlobalDashboard() {
  return (
    <div className="min-h-screen bg-gray-100 p-8">
      <div className="max-w-5xl mx-auto">
        <h1 className="text-3xl font-bold">Data Pipeline</h1>
        <p className="text-gray-600 mt-2">
          Global summary. Each source has its own complete dashboard. Shiprocket
          lives only at <code>/dashboard/shiprocket</code>.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-8">
          {SOURCES.map((source) => (
            <Link
              key={source.href}
              href={source.href}
              className="block p-6 bg-white rounded-lg shadow hover:shadow-lg"
            >
              <h2 className="text-xl font-semibold">{source.title}</h2>
              <p className="text-gray-600 mt-2">{source.body}</p>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
