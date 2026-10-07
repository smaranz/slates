import type { Metadata, Viewport } from "next";

import "../(slates)/globals.css";

export const metadata: Metadata = {
  title: "Onboarding simulator · Slates",
};

export const viewport: Viewport = {
  themeColor: "#1b1b1b",
  colorScheme: "dark",
};

export default function OnboardingSimLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
