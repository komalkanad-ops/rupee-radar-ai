interface Point {
  label: string;
  value: number;
}

// Hand-rolled SVG bar/line trend chart — same dependency-free philosophy as Donut.tsx.
export function TrendChart({
  data,
  variant = "bar",
  color = "#6366f1",
  height = 140,
}: {
  data: Point[];
  variant?: "bar" | "line";
  color?: string;
  height?: number;
}) {
  const width = Math.max(data.length * 44, 220);
  const max = Math.max(...data.map((d) => d.value), 1);
  const padding = 20;
  const chartHeight = height - padding;

  const points = data.map((d, i) => {
    const x = data.length > 1 ? (i / (data.length - 1)) * (width - 20) + 10 : width / 2;
    const y = chartHeight - (d.value / max) * (chartHeight - 10);
    return { ...d, x, y };
  });

  const linePath = points.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ");

  return (
    <svg width={width} height={height} className="overflow-visible">
      {variant === "bar" &&
        points.map((p) => (
          <g key={p.label}>
            <rect
              x={p.x - 12}
              y={p.y}
              width={24}
              height={chartHeight - p.y}
              rx={4}
              fill={color}
              opacity={0.85}
            />
            <text x={p.x} y={height} textAnchor="middle" className="fill-slate-400 text-[10px]">
              {p.label}
            </text>
          </g>
        ))}
      {variant === "line" && (
        <>
          <path d={linePath} fill="none" stroke={color} strokeWidth={2} />
          {points.map((p) => (
            <g key={p.label}>
              <circle cx={p.x} cy={p.y} r={3} fill={color} />
              <text x={p.x} y={height} textAnchor="middle" className="fill-slate-400 text-[10px]">
                {p.label}
              </text>
            </g>
          ))}
        </>
      )}
    </svg>
  );
}
