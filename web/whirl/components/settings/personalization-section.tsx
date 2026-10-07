"use client";

import { IconRestore } from "@tabler/icons-react";

import { accentLabel, DEFAULT_ACCENT, useAccent } from "@whirl/lib/accent";
import { useShowSuggestionsPref } from "@whirl/lib/home-prefs";
import { DEFAULT_TINT, useCanvasTint } from "@whirl/lib/tint";
import { ToggleSwitch } from "../toggle-switch";
import { Button } from "../ui/button";
import { AccentPicker } from "./accent-picker";
import { SettingsCard, SettingsHeader, SettingsRow } from "./settings-rows";
import { TintPicker } from "./tint-picker";

export function PersonalizationSection() {
  const { accent, setAccent } = useAccent();
  const { tint, setTint } = useCanvasTint();
  const [showSuggestions, setShowSuggestions] = useShowSuggestionsPref();

  const isDefault =
    accent === DEFAULT_ACCENT && !tint.enabled && showSuggestions;
  const reset = () => {
    setAccent(DEFAULT_ACCENT);
    setTint(DEFAULT_TINT);
    setShowSuggestions(true);
  };

  return (
    <>
      <SettingsHeader
        title="Personalization"
        description="Your corner of whirl — paint it how you like."
      />
      <div className="flex flex-col gap-4">
        <SettingsCard>
          <SettingsRow
            title="Accent color"
            description={`Buttons, toggles, and highlights all pick it up. Currently wearing ${accentLabel(accent)}.`}
          >
            <AccentPicker
              value={accent}
              onChange={setAccent}
              aria-label="Accent color"
            />
          </SettingsRow>
          <SettingsRow
            title="Background color"
            description="Your color takes over the sidebar and gently tints everything else."
            control={
              <ToggleSwitch
                checked={tint.enabled}
                onCheckedChange={(enabled) => setTint({ ...tint, enabled })}
                aria-label="Background color"
              />
            }
          >
            {tint.enabled && <TintPicker tint={tint} onChange={setTint} />}
          </SettingsRow>
        </SettingsCard>

        <SettingsCard>
          <SettingsRow
            title="Home suggestions"
            description="A couple of conversation starters under the composer, reshuffled every visit."
            control={
              <ToggleSwitch
                checked={showSuggestions}
                onCheckedChange={setShowSuggestions}
                aria-label="Home suggestions"
              />
            }
          />
        </SettingsCard>

        <SettingsCard>
          <SettingsRow
            title="Reset personalization"
            description="Back to graphite ink, a neutral canvas, and starters on the home screen."
            control={
              <Button variant="secondary" disabled={isDefault} onClick={reset}>
                <IconRestore size={16} />
                Reset
              </Button>
            }
          />
        </SettingsCard>
      </div>
    </>
  );
}
