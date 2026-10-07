/* Whirl shipped browser logs to Axiom; Slates keeps them in the console. */
export const logger = {
  info: (message: string, fields?: unknown) => console.info(message, fields ?? ""),
  warn: (message: string, fields?: unknown) => console.warn(message, fields ?? ""),
  error: (message: string, fields?: unknown) => console.error(message, fields ?? ""),
  debug: () => {},
  flush: async () => {},
};
