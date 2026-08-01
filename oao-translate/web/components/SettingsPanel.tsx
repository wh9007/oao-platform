"use client";

import { Checkbox } from "./ui";
import { SETTINGS_LABELS } from "@/lib/constants";
import { Settings } from "@/types/session";

export function SettingsPanel({
  settings,
  onChange,
}: {
  settings: Settings;
  onChange: (settings: Settings) => void;
}) {
  return (
    <section className="surface-panel rounded-xl p-4">
      <h2 className="mb-3 text-sm font-semibold">翻译设置</h2>
      <div className="grid grid-cols-1 gap-x-5 sm:grid-cols-2">
        {(Object.keys(settings) as (keyof Settings)[]).map((key) => (
          <Checkbox
            key={key}
            label={SETTINGS_LABELS[key]}
            checked={settings[key]}
            onChange={(event) => onChange({ ...settings, [key]: event.target.checked })}
          />
        ))}
      </div>
    </section>
  );
}
