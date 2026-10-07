/* The witty home-screen intro lines, ported straight from v1. `{name}` is
   the user's first name — or "Anon" while signed out, so strangers get the
   same warm welcome as regulars. Exported: the greeting boot script
   (home-intro.tsx) inlines the list so the pre-hydration paint picks from
   the same pool. */
export const GREETINGS = [
  "What's up, {name}",
  "Hey there, {name}",
  "Back again, {name}?",
  "Miss me, {name}?",
  "Oh hey, {name}",
  "Howdy, {name}",
  "Look who it is",
  "Hiya, {name}",
  "Yo, {name}",
  "Greetings, {name}",
  "Fancy seeing you, {name}",
  "Ready when you are, {name}",
  "Hello hello, {name}",
  "Good to see you, {name}",
  "Rise and shine, {name}",
  "Long time no see, {name}",
  "{name} has arrived",
  "Welcome back, {name}",
  "Let's get into it, {name}",
  "Sup, {name}",
];

/* Deterministic on the server (index 0), random on the client. Call inside
   a useState initializer with a typeof-window guard so the first client
   paint already shows the real line. */
export function pickGreeting() {
  return GREETINGS[Math.floor(Math.random() * GREETINGS.length)];
}

export const DEFAULT_GREETING = GREETINGS[0];
