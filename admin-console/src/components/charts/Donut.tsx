interface Slice {
  label: string;
  value: number;
  color: string;
}

// Hand-rolled SVG donut — mirrors the deliberate choice on the Android side (Canvas charts instead
// of a charting library) so both surfaces stay dependency-free for visualization.
export function Donut({ data, size = 160 }: { data: Slice[]; size?: number }) {
  const total = data.reduce((sum, d) => sum + d.value, 0);
  const radius = size / 2;
  const strokeWidth = radius * 0.32;
  const innerRadius = radius - strokeWidth / 2;
  const circumference = 2 * Math.PI * innerRadius;

  let offset = 0;
  const arcs = data
    .filter((d) => d.value > 0)
    .map((d) => {
      const fraction = total > 0 ? d.value / total : 0;
      const dash = fraction * circumference;
      const arc = (
        <circle
          key={d.label}
          cx={radius}
          cy={radius}
          r={innerRadius}
          fill="none"
          stroke={d.color}
          strokeWidth={strokeWidth}
          strokeDasharray={`${dash} ${circumference - dash}`}
          strokeDashoffset={-offset}
          transform={`rotate(-90 ${radius} ${radius})`}
        />
      );
      offset += dash;
      return arc;
    });

  return (
    <div className="flex items-center gap-5">
      <svg width={size} height={size}>
        {arcs}
        <text x={radius} y={radius - 4} textAnchor="middle" className="fill-slate-900 text-xl font-semibold">
          {total}
        </text>
        <text x={radius} y={radius + 16} textAnchor="middle" className="fill-slate-400 text-[10px]">
          total
        </text>
      </svg>
      <div className="space-y-1.5">
        {data.map((d) => (
          <div key={d.label} className="flex items-center gap-2 text-xs">
            <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: d.color }} />
            <span className="text-slate-500">{d.label}</span>
            <span className="font-medium text-slate-800">{d.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
