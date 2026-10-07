import { IconSearch, type Icon } from "@tabler/icons-react";

import { cn } from "@whirl/lib/utils";

/* Shared bones for the settings pane: a section heading, a bordered card
   that stacks rows with hairline dividers, and a row — optional leading
   icon in a well, title + muted description, a control pinned right, and
   room below (children) for controls too wide to sit beside the copy. */

export function SettingsHeader({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <header className="mb-6">
      <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
      <p className="mt-1 text-sm text-muted-foreground">{description}</p>
    </header>
  );
}

/** A heading that sits ABOVE a card — title + description left, an action
 *  pinned right, extra bits (meters) full-width below. Use it when a card
 *  holds a list: headers styled as rows read as content and confuse. */
export function SettingsGroupHeader({
  title,
  description,
  control,
  children,
}: {
  title: string;
  description?: string;
  control?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <div className="mb-3 px-1">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <h2 className="text-[15px]/6 font-semibold tracking-tight">
            {title}
          </h2>
          {description && (
            <p className="mt-0.5 text-[12.5px] text-muted-foreground">
              {description}
            </p>
          )}
        </div>
        {control && <div className="shrink-0">{control}</div>}
      </div>
      {children && <div className="mt-2">{children}</div>}
    </div>
  );
}

export function SettingsCard({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn(
        "divide-y divide-border rounded-lg border border-border",
        className,
      )}
    >
      {children}
    </section>
  );
}

/** A search field styled as a card row — drop it in as a SettingsCard's
 *  first child and the divider hairline comes free. Escape clears.
 *  `trailing` pins extra controls (a filter button) after the input. */
export function SettingsSearchRow({
  value,
  onChange,
  placeholder,
  trailing,
  "aria-label": ariaLabel,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  trailing?: React.ReactNode;
  "aria-label"?: string;
}) {
  return (
    <div className="flex h-11 items-center gap-2.5 px-4">
      <IconSearch size={16} className="shrink-0 text-muted-foreground" />
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape" && value) {
            event.stopPropagation();
            onChange("");
          }
        }}
        placeholder={placeholder}
        aria-label={ariaLabel ?? placeholder}
        className="h-full min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
      />
      {trailing && <span className="flex shrink-0 items-center">{trailing}</span>}
    </div>
  );
}

export function SettingsRow({
  icon: RowIcon,
  iconNode,
  title,
  description,
  control,
  children,
}: {
  icon?: Icon;
  /** Escape hatch for faces that aren't a Tabler glyph (e.g. a model's
   *  uploaded SVG icon) — rendered in the same well, wins over `icon`. */
  iconNode?: React.ReactNode;
  title: string;
  /** A node so callers can color a status phrase; still rendered muted. */
  description?: React.ReactNode;
  control?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <div className="p-4">
      <div className="flex items-center gap-3">
        {(iconNode || RowIcon) && (
          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-well text-foreground shadow-[inset_0_0_0_1px_var(--well-outline),inset_0_1px_0_0_var(--well-highlight)]">
            {iconNode ?? (RowIcon && <RowIcon size={18} />)}
          </span>
        )}
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">{title}</div>
          {/* Descriptions carry hostnames, URLs and raw server errors —
              without a break they'd sail straight out of the card. */}
          {description && (
            <p className="mt-0.5 text-[13px]/[18px] break-words text-muted-foreground">
              {description}
            </p>
          )}
        </div>
        {control && <div className="shrink-0">{control}</div>}
      </div>
      {children && <div className="mt-3">{children}</div>}
    </div>
  );
}
