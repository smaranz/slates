import type { WeatherGlyph } from "./weather-glyphs";
import {
  ClearDay,
  ClearNight,
  Drizzle,
  ExtremeRain,
  ExtremeSnow,
  Fog,
  Hail,
  Overcast,
  PartlyCloudyDay,
  PartlyCloudyDayRain,
  PartlyCloudyDaySnow,
  PartlyCloudyNight,
  PartlyCloudyNightRain,
  PartlyCloudyNightSnow,
  Rain,
  Sleet,
  Snow,
  ThunderstormsRain,
} from "./weather-glyphs";

/**
 * Maps a WMO weather code (plus day/night) to a Meteocons weather glyph. Clear
 * skies, partly-cloudy and showers carry day/night variants (sun vs moon); rain
 * and snow step through drizzle → rain → extreme by intensity, and freezing
 * precip becomes sleet. Keep the labels in sync with the server's
 * `weatherCodeLabel` in convex/inference/openMeteo.ts.
 */
export function weatherIconFor(code: number, isDay: boolean): WeatherGlyph {
  switch (code) {
    case 0:
    case 1:
      return isDay ? ClearDay : ClearNight;
    case 2:
      return isDay ? PartlyCloudyDay : PartlyCloudyNight;
    case 3:
      return Overcast;
    case 45:
    case 48:
      return Fog;
    case 51:
    case 53:
    case 55:
      return Drizzle;
    case 56:
    case 57:
      return Sleet;
    case 61:
      return Drizzle;
    case 63:
      return Rain;
    case 65:
      return ExtremeRain;
    case 66:
    case 67:
      return Sleet;
    case 71:
    case 73:
    case 77:
      return Snow;
    case 75:
      return ExtremeSnow;
    case 80:
    case 81:
      return isDay ? PartlyCloudyDayRain : PartlyCloudyNightRain;
    case 82:
      return ExtremeRain;
    case 85:
    case 86:
      return isDay ? PartlyCloudyDaySnow : PartlyCloudyNightSnow;
    case 95:
      return ThunderstormsRain;
    case 96:
    case 99:
      return Hail;
    default:
      return Overcast;
  }
}

/** Human label for a WMO code (Title-free, lowercase to match Whirl's voice). */
export function weatherLabel(code: number): string {
  switch (code) {
    case 0:
      return "clear sky";
    case 1:
      return "mainly clear";
    case 2:
      return "partly cloudy";
    case 3:
      return "overcast";
    case 45:
    case 48:
      return "fog";
    case 51:
    case 53:
    case 55:
      return "drizzle";
    case 56:
    case 57:
      return "freezing drizzle";
    case 61:
      return "light rain";
    case 63:
      return "rain";
    case 65:
      return "heavy rain";
    case 66:
    case 67:
      return "freezing rain";
    case 71:
      return "light snow";
    case 73:
      return "snow";
    case 75:
      return "heavy snow";
    case 77:
      return "snow grains";
    case 80:
    case 81:
      return "rain showers";
    case 82:
      return "heavy showers";
    case 85:
    case 86:
      return "snow showers";
    case 95:
      return "thunderstorm";
    case 96:
    case 99:
      return "thunderstorm, hail";
    default:
      return "—";
  }
}

export function WeatherIcon({
  code,
  isDay = true,
  size = 24,
  className,
}: {
  code: number;
  isDay?: boolean;
  size?: number;
  className?: string;
}) {
  const Glyph = weatherIconFor(code, isDay);
  return (
    <span className={className}>
      <Glyph size={size} />
    </span>
  );
}
