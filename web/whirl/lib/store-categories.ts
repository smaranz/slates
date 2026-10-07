/* The store's shelf order — mirrors the backend's list
   (packages/backend/convex/storeCategories.ts), which is what the
   classifier files listings under. A new shelf means touching both files.
   "Everything else" renders last and also catches rows the classifier
   hasn't reached yet (category null). */

export const STORE_CATEGORY_ORDER = [
  "Productivity",
  "Developer tools",
  "Data & analytics",
  "Docs & knowledge",
  "Communication",
  "Media & design",
  "Business & finance",
  "Search & web",
  "Everything else",
] as const;

const FALLBACK_CATEGORY = "Everything else";

/** Bucket rows into shelves, in display order, dropping empty shelves.
 *  Unknown or missing categories land on the catch-all shelf. */
export function groupByCategory<T extends { category: string | null }>(
  rows: T[],
): { title: string; items: T[] }[] {
  const buckets = new Map<string, T[]>();
  for (const row of rows) {
    const known =
      row.category !== null &&
      (STORE_CATEGORY_ORDER as readonly string[]).includes(row.category);
    const shelf = known ? row.category! : FALLBACK_CATEGORY;
    const bucket = buckets.get(shelf);
    if (bucket) bucket.push(row);
    else buckets.set(shelf, [row]);
  }
  return STORE_CATEGORY_ORDER.flatMap((title) => {
    const items = buckets.get(title);
    return items ? [{ title, items }] : [];
  });
}
