/* What a locked chat will and won't run, in one place.
 *
 * Imported by the turn handler (convex/lockedInference.ts) AND by the
 * composer in apps/v2, which is the point: the picker must offer exactly
 * the models the handler will accept, and refuse to send anything else. A
 * rule applied twice is a rule that eventually disagrees with itself, and
 * the failure mode here is a user picking a model, typing a message, and
 * only then being told no.
 *
 * The list of models itself is not here — it comes from OpenRouter, cached
 * by convex/zeroRetention.ts, because whether a model has zero-retention
 * endpoints is a fact about providers rather than something we can decide.
 * What is here is how to read that answer.
 *
 * Deliberately dependency-free so the browser can import it without
 * dragging the AI SDK or the billing client into the bundle.
 */

/** Which models a locked chat may run, as the server resolved it. */
export type LockedModelPolicy = {
  /** Preset tier keys whose current model has zero-retention endpoints.
   *  Resolved against the slug the tier actually routes to, so an admin
   *  repointing a tier moves this with it. */
  tiers: readonly string[];
  /** Catalog model slugs, same test. */
  slugs: readonly string[];
  /** Whether the list has been read from OpenRouter at all. */
  known: boolean;
};

/** Nothing is cleared until the server says otherwise. The shape a client
 *  holds before its query resolves. */
export const NO_LOCKED_MODELS: LockedModelPolicy = {
  tiers: [],
  slugs: [],
  known: false,
};

/**
 * Whether a wire model (a tier key or a catalog slug) may serve a locked
 * chat.
 *
 * An allowlist, and it stays shut while `known` is false. Not knowing
 * whether a model retains prompts is not a reason to send it one: a locked
 * chat that cannot verify the answer should refuse and say so, rather than
 * take the chance on the user's behalf.
 */
export function isClearedForLockedThread(
  wireModel: string,
  policy: LockedModelPolicy,
): boolean {
  if (!policy.known) return false;
  // Catalog models always carry a "/" in their slug, so the two namespaces
  // can never collide (see sendOptionsValidator).
  return wireModel.includes("/")
    ? policy.slugs.includes(wireModel)
    : policy.tiers.includes(wireModel);
}

/**
 * What the composer falls back to when the current pick can't serve a
 * locked chat. Null when nothing can — in which case the send is refused
 * rather than quietly redirected somewhere the user didn't choose.
 */
export function defaultLockedModel(policy: LockedModelPolicy): string | null {
  return policy.tiers[0] ?? policy.slugs[0] ?? null;
}
