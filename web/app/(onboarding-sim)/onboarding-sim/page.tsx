import { notFound } from "next/navigation";

import SimulatorEntry from "@/components/onboarding/sim/SimulatorEntry";

export default function OnboardingSimPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <SimulatorEntry />;
}
