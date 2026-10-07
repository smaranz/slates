"use client";

import {
  createContext,
  useContext,
  useEffect,
  useId,
  type ReactNode,
} from "react";

type ReportArtifactWorking = (id: string, working: boolean) => void;

const ArtifactActivityContext = createContext<ReportArtifactWorking | null>(
  null,
);

/**
 * Lets artifact cards tell their message "I'm visibly working" — including
 * the stretches only the live row knows about (a background page build
 * after its phase finalized, an inline body still settling). The message
 * uses this to keep its own pending shimmer suppressed, so a working card
 * is never accompanied by a second animated indicator.
 */
export function ArtifactActivityScope({
  report,
  children,
}: {
  report: ReportArtifactWorking;
  children: ReactNode;
}) {
  return (
    <ArtifactActivityContext.Provider value={report}>
      {children}
    </ArtifactActivityContext.Provider>
  );
}

/**
 * Report this card's working state up to the message. Outside a scope
 * (side panels) it's a no-op. Cleans up on unmount so a card that
 * disappears mid-work never leaves the message thinking it's still busy.
 */
export function useReportArtifactWorking(working: boolean) {
  const id = useId();
  const report = useContext(ArtifactActivityContext);
  useEffect(() => {
    if (!report || !working) return;
    report(id, true);
    return () => report(id, false);
  }, [report, id, working]);
}
