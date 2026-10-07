import type { Mode } from "@/lib/mode";
import type { Answers, FinishHow, HostPlatform, OnboardingEnv, ProviderState, RunsOn, StepId, SyncProgress } from "@/lib/onboarding/types";

export type LinkState = "idle" | "checking" | "slow" | "up" | "down";

export type PairState = "asking" | "needs-code" | "pairing" | "paired";

export type SignInState = "checking" | "idle" | "waiting" | "done" | "failed";

export interface Live {
  rooms?: Mode[];
  where?: RunsOn | null;
  chosen?: RunsOn;
  os?: HostPlatform;
  link?: LinkState;
  hostName?: string;
  pair?: PairState;
  signIn?: SignInState;
  domain?: string;
  sync?: SyncProgress | null;
  syncFailed?: boolean;
  providers?: ProviderState[];
  notify?: "idle" | "asking" | "granted" | "denied";
}

export type AnswersPatch = Partial<Answers> | ((answers: Answers) => Partial<Answers>);

export interface StepProps {
  env: OnboardingEnv;
  answers: Answers;
  update: (patch: AnswersPatch) => void;
  live: Live;
  patchLive: (patch: Partial<Live>) => void;
  next: () => void;
  goTo: (step: StepId) => void;
  finish: (how: FinishHow, open?: Mode | null) => void;
  overlay: HTMLElement | null;
}
