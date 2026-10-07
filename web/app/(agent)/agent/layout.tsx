import { AppShell } from "@whirl/components/app-shell";

/* The persistent frame for every Agent route. Living in a shared layout means
   moving between home, a thread and settings never remounts the shell — the
   route pages below render nothing and only claim their URLs. */
export default function AgentShellLayout({ children }: { children: React.ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
