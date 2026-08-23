import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SECRET_KEY!,
  { db: { schema: "data_pipeline" } }
);

interface StatusRow {
  current_status?: string;
  status?: string;
  courier_name?: string;
  created_at?: string;
  [key: string]: unknown;
}

interface ChartEntry {
  name: string;
  value: number;
}

export async function GET() {
  try {
    const [orders, statusSummary, courierStats, pabblyStats, hourlyVolume, recentOrders] =
      await Promise.all([
        supabase
          .from("shiprocket_orders")
          .select("*")
          .order("created_at", { ascending: false })
          .limit(1000),

        supabase
          .from("shiprocket_orders")
          .select("current_status, count")
          .then(({ data }) => {
            if (!data) return [];
            const statusMap = new Map<string, number>();
            data.forEach((row: StatusRow) => {
              const status = row.current_status || "Unknown";
              statusMap.set(status, (statusMap.get(status) || 0) + 1);
            });
            return Array.from(statusMap.entries()).map(([name, value]) => ({ name, value }));
          }),

        supabase
          .from("shiprocket_orders")
          .select("courier_name, count")
          .then(({ data }) => {
            if (!data) return [];
            const courierMap = new Map<string, number>();
            data.forEach((row: StatusRow) => {
              const courier = row.courier_name || "Unknown";
              courierMap.set(courier, (courierMap.get(courier) || 0) + 1);
            });
            return Array.from(courierMap.entries())
              .map(([name, value]) => ({ name, value }))
              .sort((a, b) => b.value - a.value)
              .slice(0, 10);
          }),

        supabase
          .from("shiprocket_pabbly_deliveries")
          .select("status, count")
          .then(({ data }) => {
            if (!data) return [];
            const statusMap = new Map<string, number>();
            data.forEach((row: StatusRow) => {
              const status = row.status || "Unknown";
              statusMap.set(status, (statusMap.get(status) || 0) + 1);
            });
            return Array.from(statusMap.entries()).map(([name, value]) => ({ name, value }));
          }),

        supabase
          .from("shiprocket_orders")
          .select("created_at")
          .then(({ data }) => {
            if (!data) return [];
            const hourlyMap = new Map<string, number>();
            data.forEach((row: StatusRow) => {
              if (!row.created_at) return;
              const date = new Date(row.created_at);
              const hour = `${date.getHours().toString().padStart(2, "0")}:00`;
              hourlyMap.set(hour, (hourlyMap.get(hour) || 0) + 1);
            });
            return Array.from(hourlyMap.entries())
              .map(([hour, count]) => ({ hour, count }))
              .sort((a, b) => a.hour.localeCompare(b.hour));
          }),

        supabase
          .from("shiprocket_orders")
          .select("*")
          .order("created_at", { ascending: false })
          .limit(10),
      ]);

    const totalOrders = orders.data?.length || 0;
    const deliveredCount =
      statusSummary.find((s: ChartEntry) => s.name?.toLowerCase() === "delivered")?.value || 0;
    const pabblySuccess =
      pabblyStats.find((s: ChartEntry) => s.name === "success")?.value || 0;
    const pabblyTotal = pabblyStats.reduce((sum: number, s: ChartEntry) => sum + s.value, 0);

    return NextResponse.json({
      summary: {
        totalOrders,
        deliveredCount,
        deliveryRate: totalOrders > 0 ? ((deliveredCount / totalOrders) * 100).toFixed(1) : "0",
        pabblySuccessRate:
          pabblyTotal > 0 ? ((pabblySuccess / pabblyTotal) * 100).toFixed(1) : "0",
        pabblyTotal,
      },
      statusBreakdown: statusSummary,
      courierPerformance: courierStats,
      pabblyStats,
      hourlyVolume,
      recentOrders: recentOrders.data || [],
    });
  } catch (error) {
    console.error("Analytics error:", error);
    return NextResponse.json(
      { error: "Failed to fetch analytics" },
      { status: 500 }
    );
  }
}
