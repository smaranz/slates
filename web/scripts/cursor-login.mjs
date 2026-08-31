#!/usr/bin/env node
// One-time login for the Cursor SDK (`@cursor/sdk`), which the Tutor view
// uses to run Grok and Composer. Separate from `cursor-agent login` — this
// mints its own 90-day key at ~/.cursor/sdk/auth.json. Run once per machine:
//   npm run cursor:login
import { Cursor } from "@cursor/sdk";

const result = await Cursor.auth.login({
  apiKeyName: "Slates Tutor",
  onLoginUrl: (url) => {
    console.log(`Open this URL to finish logging in:\n  ${url}\n`);
  },
});

console.log(`Logged in as ${result.email ?? "unknown"}.`);
