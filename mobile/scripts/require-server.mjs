import { loadEnvFile } from "node:process";

try {
  loadEnvFile();
} catch {
  // A shell-provided value works without a file.
}

const value = process.env.SLATES_MOBILE_SERVER_URL?.trim();

if (!value) {
  console.error(
    "Set SLATES_MOBILE_SERVER_URL (or add it to mobile/.env), then run npm run sync before launching."
  );
  process.exit(1);
}

try {
  const url = new URL(value);
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error();
} catch {
  console.error("SLATES_MOBILE_SERVER_URL must be a complete http:// or https:// URL.");
  process.exit(1);
}
