"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { AudioVisualizer } from "@/components/AudioVisualizer";
import { ControlBar } from "@/components/ControlBar";
import { ExportDialog } from "@/components/ExportDialog";
import { HistoryPanel } from "@/components/HistoryPanel";
import { LanguageSelector } from "@/components/LanguageSelector";
import { Logo } from "@/components/Logo";
import { QrSharePanel } from "@/components/QrSharePanel";
import { SettingsPanel } from "@/components/SettingsPanel";
import { StatusBar } from "@/components/StatusBar";
import { SubtitleDisplay } from "@/components/SubtitleDisplay";
import { VoiceSettings } from "@/components/VoiceSettings";
import { DEFAULT_SETTINGS } from "@/lib/constants";
import { toLanguageCode } from "@/lib/language-map";
import { useAudioPlayback } from "@/hooks/useAudioPlayback";
import { useSpeechSynthesis } from "@/hooks/useSpeechSynthesis";
import { useSocket } from "@/hooks/useSocket";
import { useTranslationSession } from "@/hooks/useTranslationSession";
import { HistorySession, Settings, TranscriptLine } from "@/types/session";

function TranslateApp() {
  const searchParams = useSearchParams();
  const isEmbed = searchParams.get("embed") === "1";
  const themeParam = searchParams.get("theme") === "dark" ? "dark" : "light";
  const socket = useSocket();
  const audio = useAudioPlayback();
  const tts = useSpeechSynthesis();
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [source, setSource] = useState("Auto Detect");
  const [targets, setTargets] = useState<string[]>(["中文"]);
  const [showSettings, setShowSettings] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [showExport, setShowExport] = useState(false);
  const [showQr, setShowQr] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [history, setHistory] = useState<HistorySession[]>([]);
  const [apiReady, setApiReady] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [audioLevel, setAudioLevel] = useState(0);
  const languageSyncRef = useRef({ source: "Auto Detect", targets: ["中文"] as string[] });
  const prevStatusRef = useRef<"idle" | "recording" | "paused">("idle");

  useEffect(() => {
    document.documentElement.dataset.theme = themeParam;
    return () => {
      delete document.documentElement.dataset.theme;
    };
  }, [themeParam]);

  useEffect(() => {
    if (!isEmbed) return;
    document.documentElement.classList.add("embed-mode");
    document.body.classList.add("embed-mode");
    return () => {
      document.documentElement.classList.remove("embed-mode");
      document.body.classList.remove("embed-mode");
    };
  }, [isEmbed]);

  const getSpeakPayload = useCallback((line?: TranscriptLine) => {
    if (!line) return { text: "", langHint: "zh-CN" };
    const translation =
      line.translations?.map((item) => item.text).filter(Boolean).join(" ") || line.translation;
    const text = translation || line.source;
    const langHint = translation
      ? toLanguageCode(line.translations?.[0]?.language || line.language || "zh")
      : toLanguageCode(source);
    return { text, langHint: langHint.startsWith("zh") ? "zh-CN" : langHint.startsWith("en") ? "en-US" : langHint };
  }, [source]);

  const onLine = useCallback(
    (line: TranscriptLine) => {
      if (!settings.autoPlay) return;
      const { text, langHint } = getSpeakPayload(line);
      if (!text) return;
      void tts.speak(text, langHint).catch(() => undefined);
    },
    [getSpeakPayload, settings.autoPlay, tts]
  );

  const session = useTranslationSession({
    socket,
    sourceLanguage: source,
    targetLanguages: targets,
    settings,
    onLine,
    onAudioLevel: setAudioLevel,
  });

  useEffect(() => {
    void socket
      .connect()
      .then(() => {
        setApiReady(true);
        setLoadError(null);
      })
      .catch((error: unknown) => {
        setLoadError(error instanceof Error ? error.message : "Unable to connect to translation service");
        setApiReady(false);
      });
  }, [socket]);

  useEffect(() => {
    const offTranscript = socket.on("transcript", session.handleTranscript);
    const offTranslation = socket.on("translation", session.handleTranslation);
    const offTts = socket.on("tts:audio", (payload: { audioUrl?: string }) => {
      if (settings.autoPlay && payload.audioUrl) audio.enqueue(payload.audioUrl);
    });
    const offError = socket.on("server:error", (payload: { error?: string }) => {
      if (payload?.error) setLoadError(payload.error);
    });
    return () => {
      offTranscript();
      offTranslation();
      offTts();
      offError();
    };
  }, [audio, session.handleTranscript, session.handleTranslation, settings.autoPlay, socket]);

  useEffect(() => {
    if (prevStatusRef.current === "idle" && session.status !== "idle") {
      languageSyncRef.current = { source, targets: [...targets] };
    }
    prevStatusRef.current = session.status;
  }, [session.status, source, targets]);

  useEffect(() => {
    if (session.status === "idle") return;
    const prev = languageSyncRef.current;
    if (prev.source === source && prev.targets.join("|") === targets.join("|")) return;
    session.updateLanguages(source, targets);
    languageSyncRef.current = { source, targets: [...targets] };
  }, [session.status, session.updateLanguages, source, targets]);

  const targetsLabel = targets.join(" · ");
  const activeError = loadError || session.lastError || tts.lastError;

  const handleSpeakLatest = () => {
    const latest = session.lines.at(-1);
    const { text, langHint } = getSpeakPayload(latest);
    if (!text) {
      setLoadError("暂无可朗读内容，请先开始录音并等待译文生成");
      return;
    }
    void tts.speak(text, langHint).catch((error: unknown) => {
      setLoadError(error instanceof Error ? error.message : "朗读失败");
    });
  };

  const stopSession = () => {
    session.stop();
    setShowQr(false);
    if (session.lines.length) {
      setHistory((prev) => [
        {
          id: crypto.randomUUID(),
          title: `${source} → ${targetsLabel} 会话`,
          date: new Intl.DateTimeFormat("zh-CN", {
            dateStyle: "medium",
            timeStyle: "short",
          }).format(new Date()),
          duration: "刚刚结束",
          lines: session.lines,
        },
        ...prev,
      ]);
    }
  };

  const errorBanner = activeError ? (
    <section className="theme-error shrink-0 rounded-lg p-3 text-sm">
      <p className="font-semibold">服务提示</p>
      <p className="mt-1 opacity-90">{activeError}</p>
      <p className="tx-muted mt-1 text-xs">
        当前为<strong className="mx-1 font-normal text-[var(--text-color)]">本地 Ollama 模式</strong>
        （Whisper 转写 + Qwen 翻译），不消耗 OpenAI 等云端 Token。请确认已通过「打开OAO.bat」启动，并允许麦克风。
      </p>
    </section>
  ) : null;

  const controlBar = (
    <ControlBar
      embed={isEmbed}
      status={session.status}
      onStart={() => void session.start().catch((error) => setLoadError(String(error)))}
      onPause={session.pause}
      onResume={session.resume}
      onStop={stopSession}
      onSpeak={handleSpeakLatest}
      onSettings={() => {
        setShowSettings((value) => !value);
        if (!showSettings) setShowHistory(false);
      }}
      onHistory={() => {
        setShowHistory((value) => !value);
        if (!showHistory) setShowSettings(false);
      }}
      onExport={() => setShowExport(true)}
      onQr={() => setShowQr((value) => !value)}
    />
  );

  if (isEmbed) {
    return (
      <main className="embed-root flex h-[100dvh] max-h-[100dvh] flex-col gap-2 overflow-hidden p-3">
        <header className="surface-header flex shrink-0 flex-col gap-2 pb-2 sm:flex-row sm:items-center sm:justify-between">
          <StatusBar connected={socket.connected && apiReady} recording={session.status === "recording"} localMode />
          <LanguageSelector
            embed
            source={source}
            targets={targets}
            onSource={setSource}
            onTargets={setTargets}
          />
        </header>

        {errorBanner}

        <AudioVisualizer
          embed
          level={audioLevel}
          active={session.status === "recording"}
          processing={session.processing}
        />

        <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-hidden">
          <SubtitleDisplay
            embed
            lines={session.lines}
            interimText={session.interimText}
            bilingual={settings.bilingual}
            fullscreen={fullscreen || settings.fullscreenSubtitle}
            autoScroll={settings.autoScroll}
            onFullscreen={() => setFullscreen((value) => !value)}
          />
        </div>

        <div className="surface-header shrink-0 space-y-2 pt-2">
          {showQr ? (
            <QrSharePanel
              sessionId={session.sessionId}
              targets={targets}
              theme={themeParam}
              open={showQr}
              onClose={() => setShowQr(false)}
            />
          ) : null}
          {showSettings ? (
            <div className="surface-panel max-h-56 space-y-2 overflow-y-auto rounded-xl">
              <SettingsPanel settings={settings} onChange={setSettings} />
              <VoiceSettings
                supported={tts.supported}
                voices={tts.voices}
                voiceId={tts.voiceId}
                rate={tts.rate}
                pitch={tts.pitch}
                onVoiceChange={tts.setVoiceId}
                onRateChange={tts.setRate}
                onPitchChange={tts.setPitch}
                onTest={() => {
                  void tts.speak("你好，这是 OAO 翻译朗读测试。", "zh-CN").catch(() => undefined);
                }}
              />
            </div>
          ) : null}
          {showHistory ? (
            <div className="surface-panel max-h-36 overflow-y-auto rounded-xl">
              <HistoryPanel sessions={history} onOpen={(item) => session.setLines(item.lines)} />
            </div>
          ) : null}
          {!showSettings && !showHistory && !showQr && (
            <div className="surface-panel flex flex-wrap items-center justify-between gap-2 rounded-lg px-3 py-2 text-xs">
              <span>
                {source} → {targetsLabel}
              </span>
              <span className="tx-accent">本地 Ollama · 零 Token</span>
            </div>
          )}
          {controlBar}
        </div>

        <ExportDialog open={showExport} onClose={() => setShowExport(false)} lines={session.lines} />
      </main>
    );
  }

  return (
    <main className="mx-auto min-h-screen max-w-[1500px] px-4 py-5 sm:px-7">
      <header className="surface-header mb-7 flex flex-col gap-4 pb-5 lg:flex-row lg:items-center lg:justify-between">
        <Logo />
        <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center">
          <LanguageSelector source={source} targets={targets} onSource={setSource} onTargets={setTargets} />
          <StatusBar connected={socket.connected && apiReady} recording={session.status === "recording"} localMode />
        </div>
      </header>

      {errorBanner}

      <div className="grid gap-5 xl:grid-cols-[1fr_300px]">
        <div className="space-y-5">
          <AudioVisualizer
            level={audioLevel}
            active={session.status === "recording"}
            processing={session.processing}
          />
          <SubtitleDisplay
            lines={session.lines}
            interimText={session.interimText}
            bilingual={settings.bilingual}
            fullscreen={fullscreen || settings.fullscreenSubtitle}
            autoScroll={settings.autoScroll}
            onFullscreen={() => setFullscreen((value) => !value)}
          />
          {showQr ? (
            <QrSharePanel
              sessionId={session.sessionId}
              targets={targets}
              theme={themeParam}
              open={showQr}
              onClose={() => setShowQr(false)}
            />
          ) : null}
          {controlBar}
          {showSettings && (
            <div className="space-y-5">
              <SettingsPanel settings={settings} onChange={setSettings} />
              <VoiceSettings
                supported={tts.supported}
                voices={tts.voices}
                voiceId={tts.voiceId}
                rate={tts.rate}
                pitch={tts.pitch}
                onVoiceChange={tts.setVoiceId}
                onRateChange={tts.setRate}
                onPitchChange={tts.setPitch}
                onTest={() => {
                  void tts.speak("Hello, this is an OAO Translate voice test.", "en-US").catch(() => undefined);
                }}
              />
            </div>
          )}
        </div>

        <div className="space-y-5">
          {showHistory ? (
            <HistoryPanel sessions={history} onOpen={(item) => session.setLines(item.lines)} />
          ) : (
            <section className="surface-panel rounded-xl p-5">
              <p className="text-sm font-semibold">会话状态</p>
              <div className="mt-5 space-y-4 text-sm">
                <div className="flex justify-between">
                  <span className="tx-muted">识别语言</span>
                  <span>{source}</span>
                </div>
                <div className="flex justify-between gap-3">
                  <span className="tx-muted shrink-0">翻译语言</span>
                  <span className="text-right">{targetsLabel}</span>
                </div>
                <div className="flex justify-between">
                  <span className="tx-muted">引擎</span>
                  <span className="tx-accent">本地 Ollama · 零 Token</span>
                </div>
                <div className="flex justify-between gap-3">
                  <span className="tx-muted shrink-0">说明</span>
                  <span className="text-right text-xs leading-relaxed opacity-80">
                    转写用 Whisper，翻译用 Qwen，均在本机 Ollama 运行，不走 OpenAI API
                  </span>
                </div>
              </div>
            </section>
          )}
        </div>
      </div>

      <ExportDialog open={showExport} onClose={() => setShowExport(false)} lines={session.lines} />
    </main>
  );
}

export default function Home() {
  return (
    <Suspense fallback={<div className="flex min-h-screen items-center justify-center tx-muted">加载 OAO翻译…</div>}>
      <TranslateApp />
    </Suspense>
  );
}
