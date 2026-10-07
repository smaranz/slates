import type { StreamdownProps } from "streamdown";

import { cn } from "@whirl/lib/utils";

/* Tables for assistant prose, replacing Streamdown's default (double
   frame, padded gutter, controls rows). One clean box in the house
   style: a single hairline rounded-xl container, a quietly tinted
   header band of muted normal-case labels, rows on the plain surface
   divided by the same hairline — flat, no shadows, no footer bar.
   Wide tables scroll sideways inside the box; columns never squeeze
   below their content's word width. */

export const TABLE_COMPONENTS: NonNullable<StreamdownProps["components"]> = {
  table: ({ node: _node, className, children, ...props }) => (
    <div className="my-4 w-full overflow-hidden rounded-xl border border-border">
      <div className="w-full overflow-x-auto [scrollbar-width:thin]">
        <table
          className={cn("w-full border-collapse text-[14px]/6", className)}
          {...props}
        >
          {children}
        </table>
      </div>
    </div>
  ),
  thead: ({ node: _node, className, ...props }) => (
    <thead className={cn("bg-well", className)} {...props} />
  ),
  tbody: ({ node: _node, className, ...props }) => (
    <tbody className={className} {...props} />
  ),
  /* Dividers ride the rows; `last:` drops the rule under the final row so
     the box closes on its own border. (The header band's rule comes from
     the th cells — thead's tr is also a :last-child.) */
  tr: ({ node: _node, className, ...props }) => (
    <tr
      className={cn("border-b border-border last:border-b-0", className)}
      {...props}
    />
  ),
  th: ({ node: _node, className, ...props }) => (
    <th
      className={cn(
        "border-b border-border px-4 py-2.5 text-left align-bottom text-[13.5px]/5 font-medium text-muted-foreground",
        className,
      )}
      {...props}
    />
  ),
  td: ({ node: _node, className, ...props }) => (
    <td
      className={cn("px-4 py-2.5 align-top", className)}
      {...props}
    />
  ),
};
