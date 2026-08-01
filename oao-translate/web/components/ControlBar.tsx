"use client";

import { SessionStatus } from "@/types/session";
import { Button } from "./ui";

type ControlBarProps = {
  status: SessionStatus;
  embed?: boolean;
  onStart: () => void;
  onPause: () => void;
  onResume: () => void;
  onStop: () => void;
  onSpeak: () => void;
  onSettings: () => void;
  onHistory: () => void;
  onExport: () => void;
  onQr?: () => void;
};

export function ControlBar({
  status,
  embed = false,
  onStart,
  onPause,
  onResume,
  onStop,
  onSpeak,
  onSettings,
  onHistory,
  onExport,
  onQr,
}: ControlBarProps) {
  const primary =
    status === "idle" ? (
      <Button className={embed ? "w-full py-2.5" : ""} onClick={onStart}>
        ● 开始
      </Button>
    ) : status === "recording" ? (
      <Button className={embed ? "w-full py-2.5" : ""} variant="outline" onClick={onPause}>
        Ⅱ 暂停
      </Button>
    ) : (
      <Button className={embed ? "w-full py-2.5" : ""} onClick={onResume}>
        ▶ 继续
      </Button>
    );

  if (embed) {
    return (
      <div className="surface-panel rounded-xl border border-[var(--border-color)] p-2 shadow-glow">
        <div className="grid grid-cols-2 gap-2">
          {primary}
          {status !== "idle" ? (
            <Button className="w-full py-2.5" variant="outline" onClick={onStop}>
              ■ 停止
            </Button>
          ) : (
            <Button className="w-full py-2.5" variant="outline" disabled>
              ■ 停止
            </Button>
          )}
        </div>
        <div className="mt-2 grid grid-cols-5 gap-1.5">
          <Button className="px-2 py-2 text-xs" variant="ghost" onClick={onSpeak}>
            朗读
          </Button>
          <Button className="px-2 py-2 text-xs" variant="ghost" onClick={onSettings}>
            设置
          </Button>
          <Button className="px-2 py-2 text-xs" variant="ghost" onClick={onHistory}>
            历史
          </Button>
          <Button className="px-2 py-2 text-xs" variant="ghost" onClick={onExport}>
            导出
          </Button>
          <Button className="px-2 py-2 text-xs" variant="ghost" onClick={onQr} disabled={status === "idle"}>
            扫码
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="surface-panel flex flex-wrap items-center justify-center gap-2 rounded-xl p-3">
      {primary}
      {status !== "idle" && (
        <Button variant="outline" onClick={onStop}>
          ■ 停止
        </Button>
      )}
      <Button variant="ghost" onClick={onSpeak}>
        ◖ 朗读
      </Button>
      <Button variant="ghost" onClick={onSettings}>
        ⚙ 设置
      </Button>
      <Button variant="ghost" onClick={onHistory}>
        ◷ 历史
      </Button>
      <Button variant="ghost" onClick={onExport}>
        ⇩ 导出
      </Button>
      <Button variant="ghost" onClick={onQr} disabled={status === "idle"}>
        二维码
      </Button>
    </div>
  );
}
