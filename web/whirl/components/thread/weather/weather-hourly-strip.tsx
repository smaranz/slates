import type { WeatherHour } from "@whirl/lib/messages";
import { formatHour, roundTemp } from "./weather-format";
import { WeatherIcon } from "./weather-icon";

/** A horizontally-scrolling strip of the next ~24 hours. */
export function WeatherHourlyStrip({
  hours,
  isDay,
}: {
  hours: WeatherHour[];
  isDay: boolean;
}) {
  if (hours.length === 0) return null;

  return (
    <div className="-mx-1 overflow-x-auto px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      <div className="flex gap-1">
        {hours.map((hour, index) => (
          <div
            key={hour.time}
            className="flex min-w-13 flex-col items-center gap-1.5 rounded-xl px-2 py-2"
          >
            <span className="text-[11px]/4 font-medium text-muted-foreground">
              {index === 0 ? "Now" : formatHour(hour.time)}
            </span>
            <WeatherIcon code={hour.code} isDay={isDay} size={20} />
            {/* The precip slot always renders so every column keeps the
                same height — sky blue is semantic (rain), not chrome. */}
            {hour.precipProb !== undefined && hour.precipProb > 0 ? (
              <span className="text-[10px]/3 tabular-nums text-sky-500 dark:text-sky-400">
                {hour.precipProb}%
              </span>
            ) : (
              <span className="text-[10px]/3 text-transparent">·</span>
            )}
            <span className="text-[12px]/4 font-medium tabular-nums">
              {roundTemp(hour.temp)}°
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
