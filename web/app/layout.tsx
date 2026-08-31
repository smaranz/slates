import type { Metadata, Viewport } from "next";
import "./globals.css";
import { StoreProvider } from "@/lib/store";

// The design uses the platform's rounded UI face (ui-rounded / SF Pro Rounded),
// declared in globals.css — no webfont to load.
export const metadata: Metadata = {
  title: "Slates",
  description:
    "Every assignment, quiz, and grade in one place — with the time you actually spend on each.",
};

export const viewport: Viewport = {
  themeColor: "#3d3d3d",
  colorScheme: "dark",
};

export default function RootLayout(props: LayoutProps<"/">) {
  return (
    <html lang="en">
      {/* Browser extensions commonly stamp attributes onto <body> (e.g.
          `isolation: isolate`, to get their own stacking context) before React
          hydrates, which trips the hydration diff. This suppresses the warning
          for this element's own attributes only — one level deep, so genuine
          mismatches inside the app still surface. */}
      <body suppressHydrationWarning>
        <StoreProvider>{props.children}</StoreProvider>
      </body>
    </html>
  );
}
