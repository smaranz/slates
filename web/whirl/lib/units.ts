"use client";

import { useEffect, useState } from "react";

/* Metric vs imperial for the weather widgets. Shares the main app's
   localStorage key ("units") so the pick carries across both apps;
   signed-in users additionally sync it to Convex (userContext.unitsSystem)
   so server-side weather fetches agree — the settings section owns that
   mutation. */

export type UnitsPref = "auto" | "metric" | "imperial";

export type WeatherUnits = {
  temp: "C" | "F";
  wind: "km/h" | "mph";
};

const UNITS: UnitsPref[] = ["auto", "metric", "imperial"];

/** Locale-aware default — imperial only for US, Liberia, and Myanmar. */
export function unitsForLocale(locale?: string): WeatherUnits {
  const region = locale?.split("-")[1]?.toUpperCase();
  const imperial = region === "US" || region === "LR" || region === "MM";
  return imperial ? { temp: "F", wind: "mph" } : { temp: "C", wind: "km/h" };
}

export function resolveWeatherUnits(
  pref: UnitsPref,
  locale?: string,
): WeatherUnits {
  if (pref === "imperial") return { temp: "F", wind: "mph" };
  if (pref === "metric") return { temp: "C", wind: "km/h" };
  return unitsForLocale(locale);
}

export function convertTemp(
  value: number,
  from: "C" | "F",
  to: "C" | "F",
): number {
  if (from === to) return value;
  return from === "C" ? (value * 9) / 5 + 32 : ((value - 32) * 5) / 9;
}

export function convertWind(
  value: number,
  from: "km/h" | "mph",
  to: "km/h" | "mph",
): number {
  if (from === to) return value;
  return from === "km/h" ? value * 0.621371 : value / 0.621371;
}

function readUnits(): UnitsPref {
  try {
    const stored = localStorage.getItem("units");
    return UNITS.includes(stored as UnitsPref) ? (stored as UnitsPref) : "auto";
  } catch {
    return "auto";
  }
}

export function useUnitsPref() {
  /* Seeded in an effect (not the initializer) so SSR markup and the first
     client render agree — same dance as lib/theme.ts. */
  const [units, setUnitsState] = useState<UnitsPref>("auto");

  useEffect(() => {
    setUnitsState(readUnits());
  }, []);

  const setUnits = (next: UnitsPref) => {
    setUnitsState(next);
    try {
      localStorage.setItem("units", next);
    } catch {
      // private mode etc. — the pick still applies for this visit
    }
  };

  return { units, setUnits };
}
