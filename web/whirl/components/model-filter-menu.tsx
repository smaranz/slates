"use client";

import { IconFilter, IconFilterFilled } from "@tabler/icons-react";

import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@whirl/components/ui/dropdown-menu";
import type { ComposerModel } from "@whirl/lib/models";
import { ModelGlyph } from "./model-glyph";
import { WhirlRings } from "./whirl-rings";

/* The model filter, shared by the composer's picker and the Models
   settings page: a round button opening a context menu — a Provider
   submenu (radio pick, each maker wearing its model glyph) and stacking
   capability checkboxes. The button wears primary ink while anything is
   engaged. */

/** The first-party shelf in the provider filter: every white-labeled tier
 *  files under Whirl, wearing the rings instead of a maker's mark. */
export const WHIRL_PROVIDER = "Whirl";

/** Which provider a model files under: the white-labeled tiers are ours —
 *  they group as "Whirl" — and catalog models go by their maker. */
export function providerOf(model: ComposerModel): string | undefined {
  return model.whiteLabel ? WHIRL_PROVIDER : model.company;
}

/** The capability filters — each active one keeps only models that clear
 *  its test; several stack (AND). */
export const CAPABILITY_FILTERS = [
  { key: "vision", label: "Vision", test: (m: ComposerModel) => m.vision },
  { key: "files", label: "Files", test: (m: ComposerModel) => m.files },
  {
    key: "thinking",
    label: "Thinking",
    test: (m: ComposerModel) =>
      m.thinkingLevels.some((level) => level !== "none"),
  },
  {
    key: "images",
    label: "Makes images",
    test: (m: ComposerModel) => m.imageOutput,
  },
] as const;

/** Keep only the models clearing the active provider + capability filters. */
export function filterModels(
  models: ComposerModel[],
  provider: string | null,
  capabilities: ReadonlySet<string>,
): ComposerModel[] {
  return models.filter(
    (model) =>
      (provider === null || providerOf(model) === provider) &&
      CAPABILITY_FILTERS.every(
        (filter) => !capabilities.has(filter.key) || filter.test(model),
      ),
  );
}

export function ModelFilterMenu({
  models,
  provider,
  onProviderChange,
  capabilities,
  onCapabilitiesChange,
}: {
  /** The lineup to derive the provider list from (pre-filter). */
  models: ComposerModel[];
  provider: string | null;
  onProviderChange: (provider: string | null) => void;
  capabilities: ReadonlySet<string>;
  onCapabilitiesChange: (capabilities: ReadonlySet<string>) => void;
}) {
  /* The maker list, each remembering the first model glyph seen wearing it
     so the menu can show the maker's mark. Whirl renders its own rings and
     always leads. */
  const providerLogos = new Map<string, string | undefined>();
  for (const model of models) {
    const name = providerOf(model);
    if (!name || name === WHIRL_PROVIDER) continue;
    if (!providerLogos.get(name)) {
      providerLogos.set(name, model.iconSvg);
    }
  }
  const providers = [...providerLogos.keys()].sort((a, b) =>
    a.localeCompare(b),
  );
  const active = provider !== null || capabilities.size > 0;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="Filter models"
        className={`flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-full transition-colors duration-150 ${
          active
            ? "bg-primary text-primary-foreground"
            : "text-muted-foreground hover:bg-black/[0.05] hover:text-foreground data-popup-open:bg-black/[0.05] data-popup-open:text-foreground dark:hover:bg-white/[0.06] dark:data-popup-open:bg-white/[0.06]"
        }`}
      >
        {active ? <IconFilterFilled size={15} /> : <IconFilter size={15} />}
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        side="bottom"
        sideOffset={6}
        className="w-48"
      >
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            Provider
            {provider && (
              <span className="ml-auto max-w-24 truncate pl-2 text-xs text-muted-foreground">
                {provider}
              </span>
            )}
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="w-44">
            <DropdownMenuRadioGroup
              value={provider ?? ""}
              onValueChange={(value) =>
                onProviderChange(value === "" ? null : String(value))
              }
            >
              <DropdownMenuRadioItem value="">
                All providers
              </DropdownMenuRadioItem>
              <DropdownMenuRadioItem value={WHIRL_PROVIDER}>
                <span className="relative block size-3.5 shrink-0 text-muted-foreground">
                  <WhirlRings layers={[{ className: "bg-current" }]} />
                </span>
                {WHIRL_PROVIDER}
              </DropdownMenuRadioItem>
              {providers.map((name) => (
                <DropdownMenuRadioItem key={name} value={name}>
                  <ModelGlyph
                    model={{ iconSvg: providerLogos.get(name) }}
                    size={14}
                    className="text-muted-foreground"
                  />
                  <span className="truncate">{name}</span>
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSeparator />
        {CAPABILITY_FILTERS.map((filter) => (
          <DropdownMenuCheckboxItem
            key={filter.key}
            checked={capabilities.has(filter.key)}
            closeOnClick={false}
            onCheckedChange={(checked) => {
              const next = new Set(capabilities);
              if (checked) next.add(filter.key);
              else next.delete(filter.key);
              onCapabilitiesChange(next);
            }}
          >
            {filter.label}
          </DropdownMenuCheckboxItem>
        ))}
        {active && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => {
                onProviderChange(null);
                onCapabilitiesChange(new Set());
              }}
            >
              Clear filters
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
