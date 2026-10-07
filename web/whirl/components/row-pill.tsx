/* The sidebar rows' shared hover treatment: an absolute pill layer that
   fills with the app's one hover tone (--accent), so a lit row on the rail
   matches a lit row in a menu; pressing releases it back toward the rail.
   The interactive parent must carry `group/row` and `relative`, and its
   visible children `relative` so they paint above the pill. Extra show
   conditions (e.g. keeping the pill while a menu is open) ride in via
   className. */
export function RowPill({ className = "" }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={`absolute inset-0 rounded-lg transition-[background-color] duration-150 ease-out group-hover/row:bg-accent group-active/row:bg-accent-pressed ${className}`}
    />
  );
}
