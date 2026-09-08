import { loadEnvFile } from "node:process";

try {
  loadEnvFile();
} catch {
  // The message below is more useful than Node's missing-file error.
}

const value = process.env.SLATES_MOBILE_SERVER_URL?.trim();
if (!value) {
  console.error("No SLATES_MOBILE_SERVER_URL is configured. Copy .env.example to .env and edit it.");
  process.exit(1);
}

let url;
try {
  url = new URL(value);
} catch {
  console.error("SLATES_MOBILE_SERVER_URL is not a valid URL.");
  process.exit(1);
}

try {
  const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const html = await response.text();
  if (!html.includes("Slates")) {
    throw new Error("the response did not look like the Slates portal");
  }
  console.log(`Slates answered at ${url.origin}`);
} catch (error) {
  console.error(`Could not reach ${url.href}: ${error instanceof Error ? error.message : error}`);
  process.exit(1);
}
