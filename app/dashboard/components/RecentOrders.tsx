"use client";

interface RecentOrdersProps {
  orders: Array<{
    sr_order_id: string;
    order_id: string;
    current_status: string;
    courier_name: string;
    customer_name: string;
    order_total: number;
    created_at: string;
  }>;
}

export default function RecentOrders({ orders }: RecentOrdersProps) {
  if (!orders || orders.length === 0) {
    return (
      <div className="bg-white rounded-lg p-6 shadow-lg">
        <h3 className="text-lg font-semibold mb-4">Recent Orders</h3>
        <p className="text-gray-500">No orders yet</p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg p-6 shadow-lg">
      <h3 className="text-lg font-semibold mb-4">Recent Orders</h3>
      <div className="overflow-x-auto">
        <table className="min-w-full">
          <thead>
            <tr className="border-b">
              <th className="text-left py-2">SR Order ID</th>
              <th className="text-left py-2">Order ID</th>
              <th className="text-left py-2">Status</th>
              <th className="text-left py-2">Courier</th>
              <th className="text-left py-2">Customer</th>
              <th className="text-right py-2">Total</th>
              <th className="text-left py-2">Date</th>
            </tr>
          </thead>
          <tbody>
            {orders.map((order) => (
              <tr key={order.sr_order_id} className="border-b hover:bg-gray-50">
                <td className="py-2">{order.sr_order_id}</td>
                <td className="py-2">{order.order_id}</td>
                <td className="py-2">
                  <span
                    className={`px-2 py-1 rounded text-sm ${
                      order.current_status?.toLowerCase() === "delivered"
                        ? "bg-green-100 text-green-800"
                        : order.current_status?.toLowerCase() === "shipped"
                        ? "bg-blue-100 text-blue-800"
                        : "bg-gray-100 text-gray-800"
                    }`}
                  >
                    {order.current_status}
                  </span>
                </td>
                <td className="py-2">{order.courier_name}</td>
                <td className="py-2">{order.customer_name}</td>
                <td className="py-2 text-right">
                  ₹{order.order_total?.toLocaleString()}
                </td>
                <td className="py-2">
                  {new Date(order.created_at).toLocaleDateString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
