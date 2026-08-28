import Link from "next/link";

export default function Home() {
  return (
    <main className="min-h-screen bg-gray-100 p-8">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-4xl font-bold mb-8">Data Pipeline Server</h1>
        <p className="text-lg text-gray-600 mb-8">
          Scalable data pipeline for Shiprocket, Shopify, Meta Ads, and more.
        </p>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <Link
            href="/dashboard"
            className="block p-6 bg-white rounded-lg shadow-lg hover:shadow-xl transition-shadow"
          >
            <h2 className="text-xl font-semibold mb-2">🏠 All sources</h2>
            <p className="text-gray-600">
              Global hub for Shiprocket, Shopify, Meta, and GA4.
            </p>
          </Link>

          <Link
            href="/dashboard/shiprocket"
            className="block p-6 bg-white rounded-lg shadow-lg hover:shadow-xl transition-shadow"
          >
            <h2 className="text-xl font-semibold mb-2">🚚 Shiprocket</h2>
            <p className="text-gray-600">
              One operational dashboard: KPIs, filters, orders, scans, remittance, and data quality.
            </p>
          </Link>

          <Link
            href="/dashboard/shopify"
            className="block p-6 bg-white rounded-lg shadow-lg hover:shadow-xl transition-shadow"
          >
            <h2 className="text-xl font-semibold mb-2">🛍️ Shopify Dashboard</h2>
            <p className="text-gray-600">
              View Shopify order, product, UTM, and sync-health analytics from
              the isolated Supabase pipeline.
            </p>
          </Link>

          <Link
            href="/dashboard/meta"
            className="block p-6 bg-white rounded-lg shadow-lg hover:shadow-xl transition-shadow"
          >
            <h2 className="text-xl font-semibold mb-2">📣 Meta Ads Dashboard</h2>
            <p className="text-gray-600">
              View Meta ad-level daily insights, funnel, video, and sync health
              from the isolated Supabase pipeline.
            </p>
          </Link>

          <Link
            href="/dashboard/ga4"
            className="block p-6 bg-white rounded-lg shadow-lg hover:shadow-xl transition-shadow"
          >
            <h2 className="text-xl font-semibold mb-2">📈 GA4 Dashboard</h2>
            <p className="text-gray-600">
              View GA4 daily, channel, and UTM analytics plus sync health from
              the isolated Supabase pipeline.
            </p>
          </Link>
          
          <div className="p-6 bg-white rounded-lg shadow-lg">
            <h2 className="text-xl font-semibold mb-2">🔗 Webhook Endpoints</h2>
            <ul className="text-gray-600 space-y-2">
              <li>
                <code className="bg-gray-100 px-2 rounded">
                  POST /api/webhooks/delivery-events
                </code>
              </li>
            </ul>
          </div>
        </div>
      </div>
    </main>
  );
}
