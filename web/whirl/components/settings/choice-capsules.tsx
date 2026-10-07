import type { Icon } from "@tabler/icons-react";

/* The settings pages' radio control: a row of selectable capsules.
   Monochrome flat — the selected one fills with primary ink, the rest sit
   in wells and lift on hover. */
export function ChoiceCapsules<T extends string>({
  value,
  onChange,
  options,
  "aria-label": ariaLabel,
}: {
  value: T;
  onChange: (value: T) => void;
  options: { value: T; label: string; icon?: Icon }[];
  "aria-label"?: string;
}) {
  return (
    <div role="radiogroup" aria-label={ariaLabel} className="flex gap-2">
      {options.map(({ value: option, label, icon: OptionIcon }) => {
        const selected = value === option;
        return (
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(option)}
            className={`flex h-9 flex-1 cursor-pointer items-center justify-center gap-2 rounded-full text-[13.5px]/4 font-medium transition-[background-color,color] duration-150 ${
              selected
                ? "bg-primary text-primary-foreground"
                : "bg-well text-muted-foreground shadow-[inset_0_0_0_1px_var(--well-outline),inset_0_1px_0_0_var(--well-highlight)] hover:bg-[color-mix(in_oklch,var(--well),var(--foreground)_5%)] hover:text-foreground"
            }`}
          >
            {OptionIcon && <OptionIcon size={16} />}
            {label}
          </button>
        );
      })}
    </div>
  );
}
