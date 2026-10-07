"use client";

import { useMemo, useState } from "react";
import { IconCheck, IconCloudOff, IconMapPin } from "@tabler/icons-react";
import { useMutation } from "@whirl/backend/react";
import { motion } from "motion/react";
import { api } from "@whirl/backend/convex/_generated/api";

import type { MessagePhase, WeatherDay, WeatherHour } from "@whirl/lib/messages";
import { rise } from "@whirl/lib/motion";
import {
  convertTemp,
  convertWind,
  resolveWeatherUnits,
  useUnitsPref,
} from "@whirl/lib/units";
import { WeatherCurrent } from "./weather-current";
import { WeatherDailyList } from "./weather-daily-list";
import { WeatherHourlyStrip } from "./weather-hourly-strip";

/* The inline weather card: everything it shows rides in the phase itself
   (lib/messages.ts) — no table behind it. Temperatures are stored in the
   units the server fetched; the units preference (settings → general)
   converts at render so a flip re-paints every widget instantly. */

function convertHourly(
  hours: WeatherHour[],
  from: "C" | "F",
  to: "C" | "F",
): WeatherHour[] {
  if (from === to) return hours;
  return hours.map((hour) => ({
    ...hour,
    temp: convertTemp(hour.temp, from, to),
  }));
}

function convertDaily(
  days: WeatherDay[],
  from: "C" | "F",
  to: "C" | "F",
): WeatherDay[] {
  if (from === to) return days;
  return days.map((day) => ({
    ...day,
    max: convertTemp(day.max, from, to),
    min: convertTemp(day.min, from, to),
  }));
}

/** A subtle "use my exact location" affordance, shown only on coarse guesses. */
function PreciseLocationPill() {
  const reportPrecise = useMutation(api.userContext.reportPreciseLocation);
  const [saved, setSaved] = useState(false);

  if (typeof navigator === "undefined" || !navigator.geolocation) return null;
  if (saved) {
    return (
      <span className="flex items-center gap-1 text-[11px]/4 text-muted-foreground">
        <IconCheck size={12} stroke={2.5} />
        precise next time
      </span>
    );
  }

  const onClick = () => {
    navigator.geolocation.getCurrentPosition(
      (position) => {
        void reportPrecise({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        })
          .then(() => setSaved(true))
          .catch(() => {});
      },
      () => {
        /* User declined or it failed — leave the pill as-is, no nagging. */
      },
      { timeout: 8000 },
    );
  };

  return (
    <button
      type="button"
      onClick={onClick}
      className="flex cursor-pointer items-center gap-1 rounded-full px-1.5 py-0.5 text-[11px]/4 text-muted-foreground transition-colors duration-150 hover:text-foreground"
    >
      <IconMapPin size={12} stroke={2} />
      use exact location
    </button>
  );
}

export function WeatherWidget({
  phase,
  animate,
}: {
  phase: MessagePhase;
  /** Entrance animation — only for widgets landing mid-stream. */
  animate: boolean;
}) {
  const { units } = useUnitsPref();
  const locale =
    typeof navigator !== "undefined" ? navigator.language : undefined;
  const displayUnits = resolveWeatherUnits(units, locale);
  const storedTempUnit = phase.tempUnit ?? "C";
  const storedWindUnit = phase.windUnit ?? "km/h";

  const display = useMemo(() => {
    if (phase.temp === undefined || phase.code === undefined) return null;
    const today = phase.daily?.[0];
    return {
      code: phase.code,
      temp: convertTemp(phase.temp, storedTempUnit, displayUnits.temp),
      apparentTemp:
        phase.apparentTemp !== undefined
          ? convertTemp(phase.apparentTemp, storedTempUnit, displayUnits.temp)
          : undefined,
      windSpeed:
        phase.windSpeed !== undefined
          ? convertWind(phase.windSpeed, storedWindUnit, displayUnits.wind)
          : undefined,
      high:
        today?.max !== undefined
          ? convertTemp(today.max, storedTempUnit, displayUnits.temp)
          : undefined,
      low:
        today?.min !== undefined
          ? convertTemp(today.min, storedTempUnit, displayUnits.temp)
          : undefined,
      hourly: phase.hourly
        ? convertHourly(phase.hourly, storedTempUnit, displayUnits.temp)
        : undefined,
      daily: phase.daily
        ? convertDaily(phase.daily, storedTempUnit, displayUnits.temp)
        : undefined,
    };
  }, [displayUnits, phase, storedTempUnit, storedWindUnit]);

  if (phase.error) {
    return (
      <div className="mb-2 flex items-center gap-2 text-[13.5px]/5 text-muted-foreground">
        <IconCloudOff size={15} stroke={2} className="shrink-0" />
        {phase.error}
      </div>
    );
  }

  if (!display) return null;

  return (
    <motion.div
      {...(animate ? rise(0) : { initial: false })}
      className="mb-2 w-full max-w-md rounded-2xl bg-well p-4 shadow-[inset_0_0_0_1px_var(--well-outline),inset_0_1px_0_0_var(--well-highlight)]"
    >
      <div className="mb-3 flex items-center justify-between gap-2">
        <span className="truncate text-[13.5px]/4 font-medium">
          {phase.place ?? "Weather"}
        </span>
        {phase.approximate ? (
          <PreciseLocationPill />
        ) : (
          <span className="text-[11px]/4 text-muted-foreground">now</span>
        )}
      </div>

      <WeatherCurrent
        temp={display.temp}
        apparentTemp={display.apparentTemp}
        code={display.code}
        isDay={phase.isDay ?? true}
        humidity={phase.humidity}
        windSpeed={display.windSpeed}
        high={display.high}
        low={display.low}
        tempUnit={displayUnits.temp}
        windUnit={displayUnits.wind}
      />

      {display.hourly && display.hourly.length > 0 && (
        <>
          <div className="my-3 h-px w-full bg-black/[0.06] dark:bg-white/[0.06]" />
          <WeatherHourlyStrip
            hours={display.hourly}
            isDay={phase.isDay ?? true}
          />
        </>
      )}

      {display.daily && display.daily.length > 1 && (
        <>
          <div className="my-3 h-px w-full bg-black/[0.06] dark:bg-white/[0.06]" />
          <WeatherDailyList
            days={display.daily}
            timezone={phase.timezone ?? "UTC"}
          />
        </>
      )}
    </motion.div>
  );
}
