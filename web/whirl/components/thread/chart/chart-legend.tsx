"use client";

/* The legend. Present whenever two or more things need telling apart — that
   is the rule the palette leans on, since three of the light-mode series
   colors sit under 3:1 on white and can't carry identity alone. A single
   series gets no legend box at all: the title already names it. */

export type LegendItem = {
  key: string;
  label: string;
  color: string;
  /** Shown for part-to-whole charts, where the split is the whole story. */
  value?: string;
};

export function ChartLegend({
  items,
  active,
  onActiveChange,
}: {
  items: LegendItem[];
  /** Index of the highlighted entry, or null when nothing is hovered. */
  active: number | null;
  onActiveChange: (index: number | null) => void;
}) {
  if (items.length < 2) return null;

  return (
    <ul
      className="mt-3 flex flex-wrap gap-x-3 gap-y-1"
      onPointerLeave={() => onActiveChange(null)}
    >
      {items.map((item, index) => (
        <li
          key={item.key}
          onPointerEnter={() => onActiveChange(index)}
          className={`flex min-w-0 items-center gap-1.5 text-[12px]/4 transition-opacity duration-100 ${
            active !== null && active !== index ? "opacity-45" : "opacity-100"
          }`}
        >
          <span
            aria-hidden
            className="size-2 shrink-0 rounded-full"
            style={{ backgroundColor: item.color }}
          />
          <span className="truncate text-muted-foreground">{item.label}</span>
          {item.value && (
            <span className="shrink-0 tabular-nums text-foreground">
              {item.value}
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}
