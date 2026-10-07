import { IconRosetteDiscountCheckFilled } from "@tabler/icons-react";

/* The store's verified checkmark. Blue on purpose — it rides the same
   approved exception as the composer's mention blue; everything else in
   the store stays monochrome. */
export function VerifiedBadge({ size = 14 }: { size?: number }) {
  return (
    <span
      title="Verified — made by Whirl"
      className="inline-flex shrink-0 text-[#0c82f2] dark:text-[#6db4f8]"
    >
      <IconRosetteDiscountCheckFilled size={size} aria-label="Verified" />
    </span>
  );
}
