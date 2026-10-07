import { IconPlugConnected } from "@tabler/icons-react";

/* The store's "nothing here" face — shared by empty tabs, empty searches,
   and the signed-out Installed tab (which passes a sign-in action). An
   empty well tray in the composer's recessed language, with the icon
   raised back onto the surface tone. */
export function EmptyState({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-[24px] bg-well px-6 py-14 text-center shadow-[inset_0_0_0_1px_var(--well-outline),inset_0_1px_0_0_var(--well-highlight)]">
      <span className="flex size-12 items-center justify-center rounded-full bg-surface text-muted-foreground ring-1 ring-black/[0.06] dark:ring-white/[0.08]">
        <IconPlugConnected size={24} stroke={2} />
      </span>
      <div className="flex flex-col gap-1">
        <h3 className="text-[14.5px] font-semibold tracking-tight">{title}</h3>
        <p className="mx-auto max-w-sm text-[13px] leading-relaxed text-muted-foreground">
          {body}
        </p>
      </div>
      {action}
    </div>
  );
}
