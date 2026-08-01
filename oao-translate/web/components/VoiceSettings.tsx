"use client";

import type { VoiceOption } from "@/lib/speech-synthesis";

type Props = {
  supported: boolean;
  voices: VoiceOption[];
  voiceId: string;
  rate: number;
  pitch: number;
  onVoiceChange: (voiceId: string) => void;
  onRateChange: (rate: number) => void;
  onPitchChange: (pitch: number) => void;
  onTest: () => void;
};

export function VoiceSettings({
  supported,
  voices,
  voiceId,
  rate,
  pitch,
  onVoiceChange,
  onRateChange,
  onPitchChange,
  onTest,
}: Props) {
  return (
    <section className="surface-panel rounded-xl p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">朗读声音</h2>
        <button
          type="button"
          className="rounded-lg border border-[var(--border-color)] px-2.5 py-1 text-xs hover:bg-[var(--card-bg)]"
          onClick={onTest}
        >
          试听
        </button>
      </div>
      {!supported ? (
        <p className="tx-muted text-xs">当前浏览器不支持语音朗读，请使用 Chrome 或 Edge。</p>
      ) : (
        <div className="space-y-3 text-sm">
          <label className="block space-y-1">
            <span className="tx-muted text-xs">声音</span>
            <select
              className="w-full rounded-lg border border-[var(--border-color)] bg-[var(--input-bg)] px-3 py-2"
              value={voiceId}
              onChange={(event) => onVoiceChange(event.target.value)}
            >
              <option value="">自动（按译文语言匹配）</option>
              {voices.map((voice) => (
                <option key={voice.id} value={voice.id}>
                  {voice.label}
                </option>
              ))}
            </select>
          </label>
          <label className="block space-y-1">
            <span className="tx-muted text-xs">语速 · {rate.toFixed(1)}x</span>
            <input
              type="range"
              min="0.6"
              max="1.6"
              step="0.1"
              value={rate}
              onChange={(event) => onRateChange(Number(event.target.value))}
              className="w-full"
            />
          </label>
          <label className="block space-y-1">
            <span className="tx-muted text-xs">音调 · {pitch.toFixed(1)}</span>
            <input
              type="range"
              min="0.8"
              max="1.3"
              step="0.1"
              value={pitch}
              onChange={(event) => onPitchChange(Number(event.target.value))}
              className="w-full"
            />
          </label>
        </div>
      )}
    </section>
  );
}
