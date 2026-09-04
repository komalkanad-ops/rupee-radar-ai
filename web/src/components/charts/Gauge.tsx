interface GaugeProps {
  score: number; // 0-100
  size?: number;
  label?: string;
}

// Hand-rolled SVG semicircle gauge — same dependency-free approach as Donut.tsx, kept consistent
// across the site instead of pulling in a charting library for one visual.
export function Gauge({ score, size = 200, label }: GaugeProps) {
  const clamped = Math.max(0, Math.min(100, score));
  const strokeWidth = size * 0.11;
  const r = size / 2 - strokeWidth / 2 - 4;
  const cx = size / 2;
  const cy = size / 2;
  const arcLength = Math.PI * r;
  const dash = (clamped / 100) * arcLength;

  const color = clamped >= 70 ? "#16a34a" : clamped >= 40 ? "#f59e0b" : "#dc2626";
  const tier = clamped >= 70 ? "Excellent" : clamped >= 40 ? "Good" : "Needs work";
  const path = `M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`;

  return (
    <div className="flex flex-col items-center">
      <svg width={size} height={size / 2 + strokeWidth}>
        <path d={path} fill="none" stroke="#ffffff1f" strokeWidth={strokeWidth} strokeLinecap="round" />
        <path
          d={path}
          fill="none"
          stroke={color}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={`${dash} ${arcLength - dash}`}
          style={{ transition: "stroke-dasharray 900ms ease-out" }}
        />
        <text x={cx} y={cy - strokeWidth * 0.7} textAnchor="middle" className="fill-app-text text-3xl font-bold">
          {clamped}
        </text>
      </svg>
      <p className="text-sm font-semibold" style={{ color }}>{tier}</p>
      {label && <p className="text-xs text-app-muted mt-0.5">{label}</p>}
    </div>
  );
}
