"use client";

import * as React from "react";
import {
  MessageScroller as MessageScrollerPrimitive,
  useMessageScroller,
  useMessageScrollerScrollable,
  useMessageScrollerVisibility,
} from "@shadcn/react/message-scroller";
import { IconArrowDown } from "@tabler/icons-react";

import { cn } from "@whirl/lib/utils";

/* The shadcn message-scroller primitive dressed in v2's clothes: it owns
   stick-to-bottom during streaming, new-turn anchoring (the fresh user
   message rides to the top with a peek of the previous turn), restored
   scroll positions, and the jump-to-latest button. It renders none of the
   messages itself — the thread view brings those. */

function MessageScrollerProvider(
  props: React.ComponentProps<typeof MessageScrollerPrimitive.Provider>,
) {
  return <MessageScrollerPrimitive.Provider {...props} />;
}

function MessageScroller({
  className,
  ...props
}: React.ComponentProps<typeof MessageScrollerPrimitive.Root>) {
  return (
    <MessageScrollerPrimitive.Root
      data-slot="message-scroller"
      className={cn(
        "group/message-scroller relative flex size-full min-h-0 flex-col overflow-hidden",
        className,
      )}
      {...props}
    />
  );
}

function MessageScrollerViewport({
  className,
  ...props
}: React.ComponentProps<typeof MessageScrollerPrimitive.Viewport>) {
  return (
    <MessageScrollerPrimitive.Viewport
      data-slot="message-scroller-viewport"
      className={cn(
        /* both-edges: the gutter reserves symmetrically, so the centered
           transcript column neither shifts when streaming outgrows the
           viewport nor sits off-center once the scrollbar lives there. */
        "size-full min-h-0 min-w-0 overflow-y-auto overscroll-contain [scrollbar-width:thin] [scrollbar-gutter:stable_both-edges]",
        className,
      )}
      {...props}
    />
  );
}

function MessageScrollerContent({
  className,
  ...props
}: React.ComponentProps<typeof MessageScrollerPrimitive.Content>) {
  return (
    <MessageScrollerPrimitive.Content
      data-slot="message-scroller-content"
      className={cn("flex h-max min-h-full flex-col gap-5", className)}
      {...props}
    />
  );
}

function MessageScrollerItem({
  className,
  scrollAnchor = false,
  ...props
}: React.ComponentProps<typeof MessageScrollerPrimitive.Item>) {
  return (
    <MessageScrollerPrimitive.Item
      data-slot="message-scroller-item"
      scrollAnchor={scrollAnchor}
      className={cn("min-w-0 shrink-0", className)}
      {...props}
    />
  );
}

/* Jump to latest: a raised circular chip that drops in whenever the reader
   scrolls off the live edge, and sinks away (inert) when they're caught
   up. Sits above the floating composer — the thread view positions it.

   The entrance is delayed (per-property, so hover color stays instant):
   while a reply streams, the edge detector can blip active for a frame
   before autoscroll catches back up, and an undelayed transition painted
   that as a flicker. Sub-delay blips now cancel before they show; hiding
   is still immediate. */
function MessageScrollerButton({
  className,
  ...props
}: React.ComponentProps<typeof MessageScrollerPrimitive.Button>) {
  return (
    <MessageScrollerPrimitive.Button
      data-slot="message-scroller-button"
      direction="end"
      className={cn(
        "raised absolute left-1/2 z-20 flex size-9 -translate-x-1/2 cursor-pointer items-center justify-center rounded-full border border-border bg-popover text-foreground transition-[translate,scale,opacity,background-color] duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] hover:bg-accent data-[active=true]:[transition-delay:150ms,150ms,150ms,0s] data-[active=false]:pointer-events-none data-[active=false]:translate-y-2 data-[active=false]:scale-90 data-[active=false]:opacity-0",
        className,
      )}
      {...props}
    >
      <IconArrowDown size={17} stroke={2.2} />
      <span className="sr-only">Scroll to latest</span>
    </MessageScrollerPrimitive.Button>
  );
}

export {
  MessageScrollerProvider,
  MessageScroller,
  MessageScrollerViewport,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerButton,
  useMessageScroller,
  useMessageScrollerScrollable,
  useMessageScrollerVisibility,
};
