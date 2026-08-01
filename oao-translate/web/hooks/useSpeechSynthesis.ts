"use client";

import { useCallback, useEffect, useState } from "react";
import {
  isSpeechSynthesisSupported,
  listVoiceOptions,
  speakText,
  stopSpeaking,
  type VoiceOption,
} from "@/lib/speech-synthesis";

const STORAGE_KEY = "oao-translate-tts";

type StoredTts = {
  voiceId: string;
  rate: number;
  pitch: number;
};

function loadStoredTts(): StoredTts {
  if (typeof window === "undefined") {
    return { voiceId: "", rate: 1, pitch: 1 };
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { voiceId: "", rate: 1, pitch: 1 };
    const parsed = JSON.parse(raw) as Partial<StoredTts>;
    return {
      voiceId: parsed.voiceId || "",
      rate: typeof parsed.rate === "number" ? parsed.rate : 1,
      pitch: typeof parsed.pitch === "number" ? parsed.pitch : 1,
    };
  } catch {
    return { voiceId: "", rate: 1, pitch: 1 };
  }
}

export function useSpeechSynthesis() {
  const [supported, setSupported] = useState(false);
  const [voices, setVoices] = useState<VoiceOption[]>([]);
  const [voiceId, setVoiceId] = useState("");
  const [rate, setRate] = useState(1);
  const [pitch, setPitch] = useState(1);
  const [speaking, setSpeaking] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);

  useEffect(() => {
    const stored = loadStoredTts();
    setVoiceId(stored.voiceId);
    setRate(stored.rate);
    setPitch(stored.pitch);
    setSupported(isSpeechSynthesisSupported());
    void listVoiceOptions().then(setVoices);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ voiceId, rate, pitch }));
  }, [voiceId, rate, pitch]);

  const speak = useCallback(
    async (text: string, langHint?: string) => {
      setLastError(null);
      setSpeaking(true);
      try {
        await speakText(text, { voiceId, rate, pitch, langHint });
      } catch (error) {
        const message = error instanceof Error ? error.message : "朗读失败";
        setLastError(message);
        throw error;
      } finally {
        setSpeaking(false);
      }
    },
    [pitch, rate, voiceId]
  );

  const stop = useCallback(() => {
    stopSpeaking();
    setSpeaking(false);
  }, []);

  return {
    supported,
    voices,
    voiceId,
    setVoiceId,
    rate,
    setRate,
    pitch,
    setPitch,
    speaking,
    lastError,
    speak,
    stop,
  };
}
