import "server-only";

/** One Whirl backend function, served by Slates. */
export type Args = Record<string, unknown>;
export type Fn = (args: Args) => unknown | Promise<unknown>;

/** A failure the page should show as-is (Whirl's ConvexError path). */
export class WhirlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WhirlError";
  }
}

export function fail(message: string): never {
  throw new WhirlError(message);
}
