"use client";

import { useEffect, useState } from "react";
import StatsCards from "./components/StatsCards";
import StatusChart from "./components/StatusChart";
import OrderVolumeChart from "./components/OrderVolumeChart";
import CourierChart from "./components/CourierChart";
import PabblyChart from "./components/PabblyChart";
import RecentOrders from "./components/RecentOrders";

interface AnalyticsData {
  summary: {
    totalOrders: number;
    deliveredCount: number;
    deliveryRate: string;
    pabblySuccessRate: string;
    pabblyTotal: number;
  };
  statusBreakdown: Array<{ name: string; value: number }>;
  courierPerformance: Array<{ name: string; value: number }>;
  pabblyStats: Array<{ name: string; value: number }>;
  hourlyVolume: Array<{ hour: string; count: number }>;
  recentOrders: Array<{
    sr_order_id: string;
    order_id: string;
    current_status: string;
    courier_name: string;
    customer_name: string;
    order_total: number;
    created_at: string;
  }>;
}

export default function Dashboard() {
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchAnalytics();
    const interval = setInterval(fetchAnalytics, 30000);
    return () => clearInterval(interval);
  }, []);

  async function fetchAnalytics() {
    try {
      const response = await fetch("/api/analytics");
      if (!response.ok) throw new Error("Failed to fetch analytics");
      const result = await response.json();
      setData(result);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-100 p-8">
        <div className="max-w-7xl mx-auto">
          <h1 className="text-3xl font-bold mb-8">Loading Dashboard...</h1>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-100 p-8">
        <div className="max-w-7xl mx-auto">
          <h1 className="text-3xl font-bold mb-8">Dashboard Error</h1>
          <p className="text-red-500">{error}</p>
          <button
            onClick={fetchAnalytics}
            className="mt-4 px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="min-h-screen bg-gray-100 p-8">
        <div className="max-w-7xl mx-auto">
          <h1 className="text-3xl font-bold mb-8">No Data Available</h1>
          <p>Start receiving webhooks to see analytics.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-100 p-8">
      <div className="max-w-7xl mx-auto">
        <div className="flex justify-between items-center mb-8">
          <div>
            <h1 className="text-3xl font-bold">Shiprocket Analytics</h1>
            <p className="text-gray-600 mt-2">
              <strong>Shiprocket</strong>
              {" · "}
              <a href="/dashboard/shopify">Shopify</a>
            </p>
          </div>
          <button
            onClick={fetchAnalytics}
            className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
          >
            Refresh
          </button>
        </div>

        <StatsCards summary={data.summary} />

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-8">
          <StatusChart data={data.statusBreakdown} />
          <PabblyChart data={data.pabblyStats} />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-8">
          <OrderVolumeChart data={data.hourlyVolume} />
          <CourierChart data={data.courierPerformance} />
        </div>

        <RecentOrders orders={data.recentOrders} />
      </div>
    </div>
  );
}
