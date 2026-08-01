"use client";

import { useEffect, useRef, useState } from "react";
import { LANGUAGES } from "@/lib/constants";
import { Select } from "./ui";

type Props = {
  source: string;
  targets: string[];
  embed?: boolean;
  onSource: (value: string) => void;
  onTargets: (values: string[]) => void;
};

const TARGET_LANGUAGES = LANGUAGES.filter((item) => item !== "Auto Detect");

export function LanguageSelector({ source, targets, embed = false, onSource, onTargets }: Props) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDocClick = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  const toggleTarget = (lang: string) => {
    if (targets.includes(lang)) {
      const next = targets.filter((item) => item !== lang);
      onTargets(next.length > 0 ? next : [lang]);
      return;
    }
    onTargets([...targets, lang]);
  };

  const summary = targets.length > 0 ? targets.join("、") : "请选择";

  return (
    <div ref={rootRef} className={`space-y-2 ${embed ? "w-full" : ""}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="tx-muted text-xs">源语言</span>
        <Select value={source} onChange={onSource} className="min-w-[120px]">
          {LANGUAGES.map((item) => (
            <option key={item}>{item}</option>
          ))}
        </Select>
      </div>
      <div className="relative">
        <div className="mb-1.5 flex items-center justify-between gap-2">
          <span className="tx-muted text-xs">目标语言（下拉多选）</span>
          <span className="tx-accent text-xs">{targets.length} 项已选</span>
        </div>
        <button
          type="button"
          className="theme-select flex w-full min-w-[180px] items-center justify-between gap-2 text-left"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          <span className="truncate">{summary}</span>
          <span className="tx-muted">{open ? "▲" : "▼"}</span>
        </button>
        {open ? (
          <div className="surface-panel absolute z-20 mt-1 max-h-52 w-full overflow-y-auto rounded-xl p-2 shadow-lg">
            {TARGET_LANGUAGES.map((lang) => {
              const checked = targets.includes(lang);
              return (
                <label
                  key={lang}
                  className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-[color-mix(in_srgb,var(--accent-color)_8%,transparent)]"
                >
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-[var(--accent-color)]"
                    checked={checked}
                    onChange={() => toggleTarget(lang)}
                  />
                  <span>{lang}</span>
                </label>
              );
            })}
          </div>
        ) : null}
      </div>
    </div>
  );
}
