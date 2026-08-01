"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { SubtitleDisplay } from "@/components/SubtitleDisplay";
import { toLanguageLabel } from "@/lib/language-map";
import { fetchSocketToken } from "@/lib/api";
import { TranscriptLine } from "@/types/session";
import { io, Socket } from "socket.io-client";

function ViewerApp() {
  const searchParams = useSearchParams();
  const sessionId = searchParams.get("session") || "";
  const themeParam = searchParams.get("theme");
  const targetCodes = useMemo(
    () =>
      (searchParams.get("targets") || "zh")
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean),
    [searchParams]
  );
  const [connected, setConnected] = useState(false);
  const [lines, setLines] = useState<TranscriptLine[]>([]);
  const [autoSpeak, setAutoSpeak] = useState(false);
  const [selectedTargets, setSelectedTargets] = useState<string[]>(targetCodes);
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    document.documentElement.dataset.theme = themeParam === "dark" ? "dark" : "light";
    return () => {
      delete document.documentElement.dataset.theme;
    };
  }, [themeParam]);

  useEffect(() => {
    setSelectedTargets(targetCodes.length ? targetCodes : ["zh"]);
  }, [targetCodes]);

  useEffect(() => {
    if (!sessionId) return;
    let cancelled = false;

    void (async () => {
      const token = await fetchSocketToken();
      const url = process.env.NEXT_PUBLIC_SOCKET_URL ?? "http://127.0.0.1:3011";
      const socket = io(url, { auth: { token }, transports: ["websocket"] });
      socketRef.current = socket;

      socket.on("connect", () => {
        setConnected(true);
        socket.emit("viewer:join", { sessionId }, (response: { ok?: boolean; data?: { history?: Array<{ id: string; kind: string; text: string; language?: string; timestamp: number }> } }) => {
          if (!response?.ok || !response.data?.history) return;
          const restored: TranscriptLine[] = [];
          for (const item of response.data.history) {
            if (item.kind === "transcript") {
              restored.push({
                id: item.id,
                source: item.text,
                translation: "",
                translations: [],
                language: "",
                time: "",
              });
            } else if (item.kind === "translation" && restored.length) {
              const last = restored[restored.length - 1];
              const label = toLanguageLabel(item.language || "en");
              const code = (item.language || "en").toLowerCase();
              last.translations = [...(last.translations || []), { language: code, label, text: item.text }];
              last.translation = last.translations.map((entry) => entry.text).join("\n");
            }
          }
          if (!cancelled) setLines(restored);
        });
      });
      socket.on("disconnect", () => setConnected(false));

      socket.on("transcript", (entry: { id: string; text: string }) => {
        setLines((prev) => [
          ...prev,
          {
            id: entry.id,
            source: entry.text,
            translation: "",
            translations: [],
            language: "",
            time: "",
          },
        ]);
      });

      socket.on("translation", (entry: { id: string; text: string; language?: string }) => {
        setLines((prev) => {
          if (!prev.length) return prev;
          const next = [...prev];
          const last = { ...next[next.length - 1] };
          const code = (entry.language || "en").toLowerCase();
          const label = toLanguageLabel(code);
          const existing = last.translations || [];
          const index = existing.findIndex((item) => item.language === code);
          const item = { language: code, label, text: entry.text };
          last.translations =
            index >= 0 ? existing.map((value, i) => (i === index ? item : value)) : [...existing, item];
          last.translation = last.translations.map((value) => value.text).join("\n");
          next[next.length - 1] = last;
          return next;
        });
      });
    })();

    return () => {
      cancelled = true;
      socketRef.current?.disconnect();
      socketRef.current = null;
    };
  }, [sessionId]);

  useEffect(() => {
    if (!autoSpeak) return;
    const latest = lines.at(-1);
    const text =
      latest?.translations
        ?.filter((item) => selectedTargets.includes(item.language))
        .map((item) => item.text)
        .join(" ") || latest?.translation;
    if (!text) return;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(new SpeechSynthesisUtterance(text));
  }, [autoSpeak, lines, selectedTargets]);

  const filteredLines = lines.map((line) => ({
    ...line,
    translations: line.translations?.filter((item) => selectedTargets.includes(item.language)) ?? [],
  }));

  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col gap-3 p-4">
      <header className="surface-panel rounded-xl p-4">
        <h1 className="text-lg font-bold">OAO翻译 · 手机字幕</h1>
        <p className="tx-muted mt-1 text-sm">{connected ? "已连接会话" : "正在连接…"}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {targetCodes.map((code) => {
            const label = toLanguageLabel(code);
            const active = selectedTargets.includes(code);
            return (
              <button
                key={code}
                type="button"
                className={`lang-chip ${active ? "lang-chip-active" : ""}`}
                onClick={() =>
                  setSelectedTargets((prev) =>
                    prev.includes(code) ? prev.filter((item) => item !== code) : [...prev, code]
                  )
                }
              >
                {label}
              </button>
            );
          })}
        </div>
        <label className="mt-3 flex items-center gap-2 text-sm">
          <input type="checkbox" checked={autoSpeak} onChange={(event) => setAutoSpeak(event.target.checked)} />
          语音播报选中语种
        </label>
      </header>
      <SubtitleDisplay
        lines={filteredLines}
        bilingual
        autoScroll
        embed
        fullscreen={false}
        onFullscreen={() => undefined}
      />
    </main>
  );
}

export default function ViewerPage() {
  return (
    <Suspense fallback={<div className="p-6">加载手机字幕…</div>}>
      <ViewerApp />
    </Suspense>
  );
}
