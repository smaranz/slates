import { IconDropletFilled, IconWind } from "@tabler/icons-react";

import { roundTemp } from "./weather-format";
import { WeatherIcon, weatherLabel } from "./weather-icon";

/** The hero row: big icon + temperature, condition label, and a few stats. */
export function WeatherCurrent({
  temp,
  apparentTemp,
  code,
  isDay,
  humidity,
  windSpeed,
  high,
  low,
  tempUnit,
  windUnit,
}: {
  temp: number;
  apparentTemp?: number;
  code: number;
  isDay: boolean;
  humidity?: number;
  windSpeed?: number;
  high?: number;
  low?: number;
  tempUnit: "C" | "F";
  windUnit: "km/h" | "mph";
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="flex items-center gap-3">
        <WeatherIcon code={code} isDay={isDay} size={48} />
        <div className="flex flex-col">
          <div className="flex items-start leading-none">
            <span className="text-4xl font-semibold tracking-tight tabular-nums">
              {roundTemp(temp)}
            </span>
            <span className="mt-0.5 text-lg font-medium text-muted-foreground">
              °{tempUnit}
            </span>
          </div>
          <span className="mt-1 text-[13.5px]/4 capitalize">
            {weatherLabel(code)}
          </span>
        </div>
      </div>

      <div className="flex flex-col items-end gap-1 pt-0.5 text-right">
        {(high !== undefined || low !== undefined) && (
          <div className="text-[13.5px]/4 tabular-nums">
            {high !== undefined && (
              <span className="font-medium">{roundTemp(high)}°</span>
            )}
            {low !== undefined && (
              <span className="ml-1.5 text-muted-foreground">
                {roundTemp(low)}°
              </span>
            )}
          </div>
        )}
        {apparentTemp !== undefined && (
          <span className="text-[12px]/4 text-muted-foreground">
            feels like {roundTemp(apparentTemp)}°
          </span>
        )}
        <div className="mt-0.5 flex items-center gap-3 text-[12px]/4 text-muted-foreground">
          {humidity !== undefined && (
            <span className="flex items-center gap-1">
              <IconDropletFilled size={12} />
              <span className="tabular-nums">{humidity}%</span>
            </span>
          )}
          {windSpeed !== undefined && (
            <span className="flex items-center gap-1">
              <IconWind size={13} stroke={2} />
              <span className="tabular-nums">
                {Math.round(windSpeed)} {windUnit}
              </span>
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
