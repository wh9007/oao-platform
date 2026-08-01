"use client";

import { useEffect, useRef } from "react";
import { TranscriptLine } from "@/types/session";
import { Button } from "./ui";

type Props = {
  lines: TranscriptLine[];
  interimText?: string;
  fullscreen: boolean;
  bilingual?: boolean;
  autoScroll?: boolean;
  embed?: boolean;
  onFullscreen: () => void;
};

export function SubtitleDisplay({
  lines,
  interimText = "",
  fullscreen,
  bilingual = true,
  autoScroll = true,
  embed = false,
  onFullscreen,
}: Props) {
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (autoScroll) end.current?.scrollIntoView({ behavior: "smooth" });
  }, [lines, interimText, autoScroll]);

  return (
    <section
      className={`surface-card flex min-h-0 flex-col overflow-hidden shadow-glow ${
        fullscreen ? "fixed inset-0 z-40 rounded-none" : "rounded-2xl"
      } ${embed ? "h-full flex-1" : "min-h-[430px]"}`}
    >
      <header className="surface-header flex shrink-0 items-center justify-between px-4 py-3">
        <div>
          <p className="text-sm font-semibold">实时字幕</p>
          <p className="tx-muted mt-0.5 text-xs">浏览器 / Whisper 转写 · Ollama 翻译</p>
        </div>
        {!embed && (
          <Button variant="ghost" onClick={onFullscreen}>
            {fullscreen ? "退出全屏" : "全屏字幕"}
          </Button>
        )}
      </header>
      <div className={`min-h-0 flex-1 overflow-y-auto ${embed ? "px-4 py-4" : "px-6 py-7"} space-y-5`}>
        {lines.length === 0 && !interimText ? (
          <div className="grid h-full min-h-[120px] place-items-center text-center">
            <div>
              <div className="mx-auto mb-3 h-3 w-3 animate-pulse rounded-full bg-oao shadow-glow" />
              <p className="text-base">准备开始聆听</p>
              <p className="tx-muted mt-1.5 text-sm">点击下方「开始」按钮启动同声传译</p>
            </div>
          </div>
        ) : (
          <>
          {lines.map((line) => {
            const items =
              line.translations?.length > 0
                ? line.translations
                : line.translation
                  ? [{ language: "", label: line.language || "译文", text: line.translation }]
                  : [];

            return (
              <article key={line.id} className="subtitle-line border-l-2 border-oao pl-3">
                <div className="tx-muted mb-1.5 flex flex-wrap gap-2 text-xs">
                  {line.time && <span>{line.time}</span>}
                  {line.speaker && <span>{line.speaker}</span>}
                </div>
                {bilingual && line.source ? (
                  <p className={`tx-secondary leading-relaxed ${embed ? "text-sm" : "text-lg"}`}>
                    {line.source}
                  </p>
                ) : null}
                <div className={`space-y-2 ${bilingual && line.source ? "mt-2" : ""}`}>
                  {items.length > 0 ? (
                    items.map((item) => (
                      <div key={`${line.id}-${item.language || item.label}`}>
                        <span className="tx-accent mb-0.5 inline-block text-xs font-semibold">
                          {item.label}
                        </span>
                        <p
                          className={`font-medium leading-relaxed ${
                            embed ? "text-lg" : "text-2xl"
                          }`}
                        >
                          {item.text}
                        </p>
                      </div>
                    ))
                  ) : (
                    <p className={`font-medium leading-relaxed ${embed ? "text-lg" : "text-2xl"}`}>
                      {line.source}
                    </p>
                  )}
                </div>
              </article>
            );
          })}
          {interimText ? (
            <article className="subtitle-line border-l-2 border-oao/60 pl-3 opacity-80">
              <p className={`tx-secondary leading-relaxed ${embed ? "text-sm" : "text-lg"}`}>
                {interimText}
              </p>
            </article>
          ) : null}
          </>
        )}
        <div ref={end} />
      </div>
    </section>
  );
}
