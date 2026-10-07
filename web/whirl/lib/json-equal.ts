/* Structural equality for the plain-JSON values that come off the wire.

   Not a general-purpose deep-equal: no Dates, Maps, Sets or cycles, because
   nothing that crosses a Convex query boundary is any of those. Objects,
   arrays, and primitives are the whole domain, which keeps this to a fast
   recursive walk that short-circuits on the first difference. */
export function jsonEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (typeof a !== "object" || typeof b !== "object") return false;

  const aIsArray = Array.isArray(a);
  if (aIsArray !== Array.isArray(b)) return false;

  if (aIsArray) {
    const left = a as unknown[];
    const right = b as unknown[];
    if (left.length !== right.length) return false;
    for (let i = 0; i < left.length; i += 1) {
      if (!jsonEqual(left[i], right[i])) return false;
    }
    return true;
  }

  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  const keys = Object.keys(left);
  if (keys.length !== Object.keys(right).length) return false;
  for (const key of keys) {
    if (!Object.hasOwn(right, key)) return false;
    if (!jsonEqual(left[key], right[key])) return false;
  }
  return true;
}
