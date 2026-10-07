"use client";

import { IconChevronLeft, IconChevronRight } from "@tabler/icons-react";

import { Button } from "@whirl/components/ui/button";

/* The pager that sits as a card's last row — a quiet "Page 2 of 7" on the
   left, arrows on the right. Renders nothing when there's only one page, so
   callers can drop it in unconditionally. */
export function ListPager({
  page,
  totalPages,
  onChange,
  disabled,
}: {
  page: number;
  totalPages: number;
  onChange: (page: number) => void;
  disabled?: boolean;
}) {
  if (totalPages <= 1) return null;

  return (
    <div className="flex items-center justify-between gap-2 px-4 py-2.5">
      <span className="text-[12.5px] tabular-nums text-muted-foreground">
        Page {page} of {totalPages}
      </span>
      <div className="flex items-center gap-1">
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Previous page"
          className="text-muted-foreground"
          disabled={disabled || page <= 1}
          onClick={() => onChange(page - 1)}
        >
          <IconChevronLeft size={16} stroke={2} />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Next page"
          className="text-muted-foreground"
          disabled={disabled || page >= totalPages}
          onClick={() => onChange(page + 1)}
        >
          <IconChevronRight size={16} stroke={2} />
        </Button>
      </div>
    </div>
  );
}
