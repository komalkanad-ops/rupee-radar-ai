export function SkeletonBlock({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded-md bg-slate-200 ${className}`} />;
}

export function SkeletonRows({ rows = 4, cols = 4 }: { rows?: number; cols?: number }) {
  return (
    <div className="divide-y divide-slate-100">
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="flex gap-6 px-4 py-3.5">
          {Array.from({ length: cols }).map((_, c) => (
            <SkeletonBlock key={c} className="h-4 flex-1" />
          ))}
        </div>
      ))}
    </div>
  );
}
