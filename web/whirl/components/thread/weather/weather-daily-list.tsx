import type { WeatherDay } from "@whirl/lib/messages";
import { formatWeekday, isToday, roundTemp } from "./weather-format";
import { WeatherIcon } from "./weather-icon";

/** A compact 7-day list with a relative hi/lo temperature bar per row. */
export function WeatherDailyList({
  days,
  timezone,
}: {
  days: WeatherDay[];
  timezone: string;
}) {
  if (days.length === 0) return null;

  /* The bar is positioned within the whole week's range so the days read
     as a single comparable scale. */
  const weekMin = Math.min(...days.map((day) => day.min));
  const weekMax = Math.max(...days.map((day) => day.max));
  const span = Math.max(weekMax - weekMin, 1);

  return (
    <div className="flex flex-col">
      {days.map((day, index) => {
        const today = index === 0 || isToday(day.date, timezone);
        const left = ((day.min - weekMin) / span) * 100;
        const width = Math.max(((day.max - day.min) / span) * 100, 6);
        return (
          <div
            key={day.date}
            className="flex items-center gap-3 py-1.5 text-[13.5px]/4"
          >
            <span className="w-10 shrink-0 font-medium">
              {today ? "Today" : formatWeekday(day.date)}
            </span>
            <WeatherIcon code={day.code} isDay size={18} className="shrink-0" />
            <span className="w-8 shrink-0 text-right text-[12px]/4 tabular-nums text-sky-500 dark:text-sky-400">
              {day.precipProb !== undefined && day.precipProb > 0
                ? `${day.precipProb}%`
                : ""}
            </span>
            <span className="w-7 shrink-0 text-right text-[12px]/4 tabular-nums text-muted-foreground">
              {roundTemp(day.min)}°
            </span>
            {/* Cold→warm gradient, positioned in the week's shared range. */}
            <div className="relative h-1.5 flex-1 rounded-full bg-black/[0.06] dark:bg-white/[0.08]">
              <div
                className="absolute h-full rounded-full bg-gradient-to-r from-sky-400 to-amber-400 dark:from-sky-500 dark:to-amber-400"
                style={{ left: `${left}%`, width: `${width}%` }}
              />
            </div>
            <span className="w-7 shrink-0 text-[12px]/4 font-medium tabular-nums">
              {roundTemp(day.max)}°
            </span>
          </div>
        );
      })}
    </div>
  );
}
