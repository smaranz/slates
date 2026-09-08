import { loadEnvFile } from "node:process";

import type { CapacitorConfig } from "@capacitor/cli";

// Keep a developer's LAN address out of version control while making normal
// `cap sync` / IDE builds repeatable after it is chosen once in mobile/.env.
try {
  loadEnvFile();
} catch {
  // No .env is a supported state: the packaged connection-help page is shown.
}

const rawServerUrl = process.env.SLATES_MOBILE_SERVER_URL?.trim();

if (rawServerUrl && !/^https?:\/\//i.test(rawServerUrl)) {
  throw new Error("SLATES_MOBILE_SERVER_URL must start with http:// or https://");
}

// The web app's own `--bg` (oklch(0.26 0 0)) in hex. Every native surface that
// can show before or around the web view — the window, the splash, the status
// bar — is set to this one value, so launching the app is a single colour from
// the first frame rather than a slideshow of near-greys.
const SHELL_BG = "#242424";

const config: CapacitorConfig = {
  appId: "com.slates.app",
  appName: "Slates",
  webDir: "www",
  backgroundColor: SHELL_BG,
  ios: {
    contentInset: "never",
    preferredContentMode: "mobile",
  },
  android: {
    backgroundColor: SHELL_BG,
  },
  server: rawServerUrl
    ? {
        url: rawServerUrl.replace(/\/$/, ""),
        cleartext: rawServerUrl.startsWith("http://"),
        errorPath: "connection-error.html",
      }
    : {
        androidScheme: "https",
        errorPath: "connection-error.html",
      },
  plugins: {
    SplashScreen: {
      launchAutoHide: true,
      launchShowDuration: 800,
      launchFadeOutDuration: 180,
      backgroundColor: SHELL_BG,
      // Match iOS, which draws the launch image with scaleAspectFill. The
      // artwork is a full-bleed opaque field, so cropping it costs nothing and
      // keeps the mark the same size on both platforms — CENTER_INSIDE fits
      // the square to the *width* of a tall phone and shrinks the mark by half.
      androidScaleType: "CENTER_CROP",
      showSpinner: false,
    },
    StatusBar: {
      style: "LIGHT",
      backgroundColor: SHELL_BG,
      overlaysWebView: true,
    },
    LocalNotifications: {
      // Foreground alerts behave like normal reminders, but Slates never owns
      // the app badge because it has no authoritative unread count.
      presentationOptions: ["banner", "list", "sound"],
    },
    Keyboard: {
      resize: "body",
    },
  },
};

export default config;
