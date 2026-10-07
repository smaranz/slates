import type { Metadata, Viewport } from "next";

import DesktopInbox from "@/components/DesktopInbox";
import { ViewportInsets } from "@whirl/components/mobile/viewport-insets";
import { ThemeColor } from "@whirl/components/pwa/theme-color";
import { SIDEBAR_BOOT_SCRIPT, THEME_BOOT_SCRIPT, TINT_BOOT_SCRIPT } from "@whirl/lib/boot-scripts";

import "katex/dist/katex.min.css";
import "@whirl/globals.css";
import "streamdown/styles.css";

/**
 * The Agent app's own root.
 *
 * Its interface is Whirl's (github.com/whirlchat/whirl, MIT — see
 * whirl/LICENSE): Tailwind and a token set of its own that would fight
 * Slates' stylesheet if both loaded on one page. A separate root layout keeps
 * them apart — Next swaps root layouts with a full load, so this CSS never
 * meets app/(slates)/globals.css.
 */

export const metadata: Metadata = {
  title: "Agent · Slates",
  description: "AI teammates that work on your PC.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  interactiveWidget: "resizes-visual",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#181818" },
  ],
};

export default function AgentRootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning className="h-full antialiased">
      <head>
        <link rel="preload" href="/whirl/fonts/InterVariable.woff2" as="font" type="font/woff2" crossOrigin="anonymous" />
        {/* Theme, accent, tint and sidebar width painted during parse, so a
            load never flashes the wrong one. Fixed strings — see boot-scripts. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
        <script dangerouslySetInnerHTML={{ __html: TINT_BOOT_SCRIPT }} />
        <script dangerouslySetInnerHTML={{ __html: SIDEBAR_BOOT_SCRIPT }} />
      </head>
      <body className="h-full" suppressHydrationWarning>
        {/* On the Mac app, files agents send land in Downloads wherever you are. */}
        <DesktopInbox />
        <ThemeColor />
        <ViewportInsets />
        {children}
      </body>
    </html>
  );
}
