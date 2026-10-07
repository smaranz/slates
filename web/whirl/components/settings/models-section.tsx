"use client";

import { useState } from "react";
import { IconArchive, IconChevronDown } from "@tabler/icons-react";

import { filterModels, ModelFilterMenu } from "@whirl/components/model-filter-menu";
import { ModelGlyph } from "@whirl/components/model-glyph";
import { useModelAccess } from "@whirl/lib/model-access";
import { useComposerModels } from "@whirl/lib/model-catalog";
import { useModelFavorites } from "@whirl/lib/model-favorites";
import { searchModels } from "@whirl/lib/model-search";
import type { ComposerModel } from "@whirl/lib/models";
import { ToggleSwitch } from "../toggle-switch";
import {
  SettingsCard,
  SettingsHeader,
  SettingsRow,
  SettingsSearchRow,
} from "./settings-rows";

function capabilityBlurb(model: ComposerModel): string {
  const bits = [
    model.imageOutput ? "paints pictures" : null,
    model.vision ? "sees images" : null,
    model.files ? "reads files" : null,
    model.thinkingLevels.some((level) => level !== "none")
      ? "can think hard"
      : null,
  ].filter((bit): bit is string => bit !== null);

  const blurb = bits.join(" · ");
  return blurb.charAt(0).toUpperCase() + blurb.slice(1);
}

export function ModelsSection() {
  const models = useComposerModels();
  const { favorites, toggleFavorite } = useModelFavorites();
  const { isPaid } = useModelAccess();
  const [query, setQuery] = useState("");
  const [provider, setProvider] = useState<string | null>(null);
  const [capabilities, setCapabilities] = useState<ReadonlySet<string>>(
    new Set(),
  );
  const [legacyOpen, setLegacyOpen] = useState(false);

  /* Same visibility rule as the picker: Free (key Fast) belongs to the
     free plan alone. */
  const visibleModels = models.filter(
    (model) => model.key !== "Fast" || isPaid === false,
  );

  /* Legacy models fold behind a count row here too — same shelf as the
     picker; a typed search finds them directly. */
  const needle = query.trim();
  const filtered = filterModels(visibleModels, provider, capabilities);
  const shownModels = needle
    ? searchModels(filtered, needle)
    : filtered.filter((model) => !model.legacy);
  const legacyModels = needle
    ? []
    : filtered.filter((model) => model.legacy);

  const modelRow = (model: ComposerModel) => (
    <SettingsRow
      key={model.key}
      iconNode={<ModelGlyph model={model} size={18} />}
      title={model.fullName ?? model.name}
      description={capabilityBlurb(model)}
      control={
        <ToggleSwitch
          checked={favorites.has(model.key)}
          onCheckedChange={() => toggleFavorite(model.key)}
          aria-label={`Show ${model.name} in the quick picker`}
        />
      }
    />
  );

  return (
    <>
      <SettingsHeader
        title="Models"
        description="Choose which models show up in the composer's quick picker."
      />
      <SettingsCard>
        <SettingsSearchRow
          value={query}
          onChange={setQuery}
          placeholder="Search models…"
          trailing={
            <ModelFilterMenu
              models={visibleModels}
              provider={provider}
              onProviderChange={setProvider}
              capabilities={capabilities}
              onCapabilitiesChange={setCapabilities}
            />
          }
        />
        {shownModels.map(modelRow)}
        {legacyModels.length > 0 && (
          <button
            type="button"
            aria-expanded={legacyOpen}
            onClick={() => setLegacyOpen((prev) => !prev)}
            className="flex h-11 w-full cursor-pointer items-center gap-2.5 px-4 text-sm text-muted-foreground transition-colors duration-100 hover:text-foreground"
          >
            <IconArchive size={16} className="shrink-0" />
            {legacyModels.length} legacy{" "}
            {legacyModels.length === 1 ? "model" : "models"}
            <IconChevronDown
              size={15}
              className={`ml-auto shrink-0 transition-[rotate] duration-150 ${
                legacyOpen ? "rotate-180" : ""
              }`}
            />
          </button>
        )}
        {legacyOpen && legacyModels.map(modelRow)}
        {shownModels.length === 0 && legacyModels.length === 0 && (
          <p className="p-4 text-sm text-muted-foreground">
            {needle
              ? `No models match “${query.trim()}”.`
              : "No models wear all those filters."}
          </p>
        )}
      </SettingsCard>
    </>
  );
}
