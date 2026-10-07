"use client";

import dynamic from "next/dynamic";

const OnboardingSimulator = dynamic(() => import("./OnboardingSimulator"), {
  ssr: false,
  loading: () => <div style={{ height: "100dvh", background: "oklch(0.205 0 0)" }} />,
});

export default function SimulatorEntry() {
  return <OnboardingSimulator />;
}
