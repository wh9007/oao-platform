"use client";

import { useEffect, useRef, useState } from "react";

type Props = {
  level: number;
  active: boolean;
  processing?: boolean;
  embed?: boolean;
};

export function AudioVisualizer({ level, active, processing = false, embed = false }: Props) {
  const bars = 24;
  const [frame, setFrame] = useState(0);
  const rafRef = useRef(0);

  useEffect(() => {
    const tick = () => {
      setFrame((value) => value + 1);
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, []);

  const pulse = active ? 0.35 + level * 0.65 : 0.15;

  return (
    <div
      className={`surface-panel flex items-center gap-3 rounded-xl px-3 py-2 ${
        embed ? "w-full" : ""
      } ${processing ? "ring-1 ring-[var(--accent-color)]" : ""}`}
      aria-live="polite"
    >
      <div className="flex h-8 flex-1 items-end gap-0.5">
        {Array.from({ length: bars }).map((_, index) => {
          const wave = active
            ? Math.abs(Math.sin((frame + index * 2) / 6)) * pulse + level * 0.35
            : 0.12 + Math.abs(Math.sin((frame + index) / 10)) * 0.08;
          const height = Math.max(12, Math.min(100, wave * 100));
          return (
            <span
              key={index}
              className="flex-1 rounded-full bg-[var(--accent-color)] transition-[height] duration-75"
              style={{ height: `${height}%`, opacity: active ? 0.55 + wave * 0.45 : 0.25 }}
            />
          );
        })}
      </div>
      <div className="min-w-[88px] text-right text-xs">
        <p className={`font-semibold ${active ? "tx-accent" : "tx-muted"}`}>
          {processing ? "转写中…" : active ? "正在聆听" : "等待开始"}
        </p>
        <p className="tx-muted mt-0.5">{active ? `${Math.round(level * 100)}% 音量` : "麦克风待命"}</p>
      </div>
    </div>
  );
}
