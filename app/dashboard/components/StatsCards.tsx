"use client";

interface StatsCardsProps {
  summary: {
    totalOrders: number;
    deliveredCount: number;
    deliveryRate: string;
    pabblySuccessRate: string;
    pabblyTotal: number;
  };
}

export default function StatsCards({ summary }: StatsCardsProps) {
  const cards = [
    {
      label: "Total Orders",
      value: summary.totalOrders.toLocaleString(),
      color: "bg-blue-500",
    },
    {
      label: "Delivered",
      value: summary.deliveredCount.toLocaleString(),
      color: "bg-green-500",
    },
    {
      label: "Delivery Rate",
      value: `${summary.deliveryRate}%`,
      color: "bg-purple-500",
    },
    {
      label: "Pabbly Success",
      value: `${summary.pabblySuccessRate}%`,
      color: "bg-orange-500",
    },
  ];

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
      {cards.map((card) => (
        <div
          key={card.label}
          className={`${card.color} rounded-lg p-6 text-white shadow-lg`}
        >
          <p className="text-sm opacity-90">{card.label}</p>
          <p className="text-3xl font-bold mt-2">{card.value}</p>
        </div>
      ))}
    </div>
  );
}
