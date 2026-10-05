"use client";

import { Capacitor, registerPlugin } from "@capacitor/core";
import { useEffect } from "react";

/**
 * The phone app's status bar (clock, signal, battery) in white, which is what
 * reads over Slates' dark top; the student asked for it. The app sets the
 * same at launch (mobile/capacitor.config.ts), but an install from before
 * that change only gets it from here. Anywhere but the app this does nothing.
 */

// The native plugin ships in the app, so it's reached by name rather than through a web dependency.
const StatusBar = registerPlugin<{ setStyle(options: { style: "DARK" | "LIGHT" }): Promise<void> }>("StatusBar");

export default function NativeStatusBar() {
  useEffect(() => {
    // Capacitor names the background: "DARK" is white text.
    if (Capacitor.isNativePlatform()) StatusBar.setStyle({ style: "DARK" }).catch(() => {});
  }, []);
  return null;
}
