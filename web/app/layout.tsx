import type { Metadata, Viewport } from "next";
import "katex/dist/katex.min.css";
import "./globals.css";
import { CounselorProvider } from "@/lib/counselor/store";
import { IdentityProvider } from "@/lib/identity";
import { ModeProvider } from "@/lib/mode";
import { StoreProvider } from "@/lib/store";

// The design uses the platform's rounded UI face (ui-rounded / SF Pro Rounded),
// declared in globals.css — no webfont to load.
export const metadata: Metadata = {
  title: "Slates",
  description:
    "Every assignment, quiz, and grade in one place — with the time you actually spend on each.",
};

export const viewport: Viewport = {
  // The app background, not the icon tile — this paints the browser and PWA
  // chrome, so it has to be the colour the page actually starts with.
  themeColor: "#242424",
  colorScheme: "dark",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  interactiveWidget: "resizes-content",
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
        {/* Identity is outermost: both halves of the app read the student's
            name and photo from it, so it has to exist before either store. */}
        <IdentityProvider>
          <ModeProvider>
            <StoreProvider>
              {/* The counselor's record is mounted app-wide, not just inside
                  the counselor: essays live in it and are edited from the
                  school side, while the counselor still reads them. */}
              <CounselorProvider>{props.children}</CounselorProvider>
            </StoreProvider>
          </ModeProvider>
        </IdentityProvider>
      </body>
    </html>
  );
}
