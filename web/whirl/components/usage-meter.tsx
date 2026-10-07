/* Continuous usage bar: a hairline track with the remaining share filled
   emerald, animating as the balance moves. */
export function UsageMeter({
  remainingPct,
  className = "",
}: {
  remainingPct: number;
  className?: string;
}) {
  return (
    <div
      role="meter"
      aria-valuenow={Math.round(remainingPct)}
      aria-valuemin={0}
      aria-valuemax={100}
      className={`h-1.5 w-full overflow-hidden rounded-full bg-black/[0.08] dark:bg-white/[0.08] ${className}`}
    >
      <div
        className="h-full rounded-full bg-emerald-500 transition-[width] duration-300 dark:bg-emerald-400"
        style={{ width: `${Math.min(100, Math.max(0, remainingPct))}%` }}
      />
    </div>
  );
}
