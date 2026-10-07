/* Money formatting helpers. Usage costs are reported in USD and are often
   tiny (a single reply can cost a fraction of a cent), so we keep two
   formatters: a standard currency one for balances and totals, and a
   fine-grained one that keeps small per-request amounts readable instead of
   rounding them to $0.00. Mirrors the main app's lib/money.ts. */

const USD = new Intl.NumberFormat(undefined, {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** Standard USD with two decimals — for balances, totals, and top-up amounts. */
export function formatUsd(amount: number): string {
  if (!Number.isFinite(amount)) return "$0.00";
  return USD.format(amount);
}

/**
 * Fine-grained USD for small consumption amounts. Falls back to extra decimals
 * (and a `<` floor) so a sub-cent charge still shows a meaningful number
 * rather than collapsing to $0.00.
 */
export function formatUsdFine(amount: number): string {
  if (!Number.isFinite(amount) || amount <= 0) return "$0.00";
  if (amount >= 0.01) return USD.format(amount);
  if (amount >= 0.0001) return `$${amount.toFixed(4)}`;
  return "<$0.0001";
}
