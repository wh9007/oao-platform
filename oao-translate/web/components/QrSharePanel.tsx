"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { toLanguageCode } from "@/lib/language-map";

type Props = {
  sessionId: string | null;
  targets: string[];
  theme: string;
  open: boolean;
  onClose: () => void;
};

function buildViewerUrl(sessionId: string, targets: string[], theme: string) {
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const params = new URLSearchParams({
    session: sessionId,
    theme,
    targets: targets.map((item) => toLanguageCode(item)).join(","),
  });
  return `${origin}/view?${params.toString()}`;
}

export function QrSharePanel({ sessionId, targets, theme, open, onClose }: Props) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const viewerUrl = useMemo(
    () => (sessionId ? buildViewerUrl(sessionId, targets, theme) : ""),
    [sessionId, targets, theme]
  );
  const isLocalHost =
    typeof window !== "undefined" &&
    (window.location.hostname === "127.0.0.1" || window.location.hostname === "localhost");

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  if (!open || !sessionId) return null;

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(viewerUrl);
      setCopied(true);
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  };

  return (
    <section className="surface-panel rounded-xl p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div>
          <p className="text-sm font-semibold">手机扫码看字幕</p>
          <p className="tx-muted text-xs">扫码后在手机选择译文语种，可文本显示或语音播报</p>
        </div>
        <button type="button" className="theme-btn-ghost rounded-lg px-2 py-1 text-xs" onClick={onClose}>
          收起
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <img
          src={`https://api.qrserver.com/v1/create-qr-code/?size=160x160&data=${encodeURIComponent(viewerUrl)}`}
          alt="字幕查看二维码"
          width={120}
          height={120}
          className="rounded-lg border border-[var(--border-color)] bg-white p-1"
        />
        <div className="min-w-[180px] flex-1 space-y-2 text-xs">
          {isLocalHost ? (
            <p className="tx-accent">
              手机需与电脑同一 Wi‑Fi，并将链接中的 127.0.0.1 替换为电脑局域网 IP。
            </p>
          ) : null}
          <p className="break-all">{viewerUrl}</p>
          <button type="button" className="theme-btn-outline rounded-lg px-3 py-1.5" onClick={() => void copyLink()}>
            {copied ? "已复制" : "复制链接"}
          </button>
        </div>
      </div>
    </section>
  );
}
