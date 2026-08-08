import type { Server, Socket } from "socket.io";
import type { AuthUser } from "../auth/jwt";
import { env } from "../config/env";
import type { ProviderName } from "../providers/types";
import type { HistoryEntry } from "../services/history-store";
import { SessionManager, type TranslationSession } from "../services/session-manager";

interface StartPayload {
  provider?: ProviderName;
  sourceLanguage?: string;
  targetLanguage?: string;
  targetLanguages?: string[];
}

interface SettingsPayload {
  sessionId: string;
  sourceLanguage?: string;
  targetLanguage?: string;
  targetLanguages?: string[];
}

interface SessionPayload {
  sessionId: string;
}

interface ViewerJoinPayload {
  sessionId: string;
}

interface ShareOpenPayload {
  sessionId: string;
  sourceLanguage?: string;
  targetLanguage?: string;
  targetLanguages?: string[];
}

interface SharePushPayload {
  sessionId: string;
  kind: "transcript" | "translation";
  text?: string;
  language?: string;
  sourceText?: string;
}

type Acknowledge = (response: { ok: boolean; error?: string; data?: unknown }) => void;

const PROVIDERS = new Set<ProviderName>(["ollama", "openai", "google", "azure", "deepl", "gemini", "claude"]);

export function registerSocketHandlers(io: Server, sessions: SessionManager): void {
  io.on("connection", (socket) => {
    const user = socket.data.user as AuthUser;
    socket.emit("socket:ready", { userId: user.id, timestamp: Date.now() });

    socket.on("session:start", async (payload: StartPayload = {}, acknowledge?: Acknowledge) => {
      try {
        const provider = payload.provider ?? env.DEFAULT_PROVIDER;
        if (!PROVIDERS.has(provider)) throw new Error("Unsupported provider");
        const targetLanguages = normalizeTargetLanguages(payload);
        const session = await sessions.start({
          userId: user.id,
          provider,
          languages: {
            source: payload.sourceLanguage?.trim() || "auto",
            target: targetLanguages[0] || "",
            targets: targetLanguages
          }
        });
        bindProviderEvents(io, socket, sessions, session);
        await socket.join(session.id);
        acknowledge?.({ ok: true, data: serializeSession(session) });
      } catch (error) {
        acknowledge?.({ ok: false, error: messageOf(error) });
      }
    });

    socket.on("session:pause", async (payload: SessionPayload, acknowledge?: Acknowledge) => {
      await handleSessionAction(socket, sessions, payload, acknowledge, (session) => sessions.pause(session));
    });

    socket.on("session:resume", async (payload: SessionPayload, acknowledge?: Acknowledge) => {
      await handleSessionAction(socket, sessions, payload, acknowledge, (session) => sessions.resume(session));
    });

    socket.on("session:stop", async (payload: SessionPayload, acknowledge?: Acknowledge) => {
      await handleSessionAction(socket, sessions, payload, acknowledge, (session) => sessions.stop(session));
    });

    socket.on("audio:chunk", async (payload: SessionPayload & { audio: Buffer | ArrayBuffer | Uint8Array }, acknowledge?: Acknowledge) => {
      try {
        const session = requireSession(sessions, payload.sessionId, user.id);
        if (session.state !== "active") throw new Error("Session is not active");
        const raw = payload.audio;
        const audioBuffer = Buffer.isBuffer(raw)
          ? raw
          : Buffer.from(raw instanceof ArrayBuffer ? new Uint8Array(raw) : raw);
        if (audioBuffer.length === 0) {
          throw new Error("Audio chunk must be a non-empty binary buffer");
        }
        session.providerInstance.processAudioChunk(audioBuffer);
        acknowledge?.({ ok: true });
      } catch (error) {
        acknowledge?.({ ok: false, error: messageOf(error) });
      }
    });

    socket.on(
      "text:transcript",
      async (
        payload: SessionPayload & { text?: string; speaker?: string; dialogueRole?: "self" | "guest" },
        acknowledge?: Acknowledge
      ) => {
        try {
          const session = requireSession(sessions, payload.sessionId, user.id);
          if (session.state !== "active") throw new Error("Session is not active");
          const text = payload.text?.trim();
          if (!text) throw new Error("Transcript text is required");
          const handler = session.providerInstance.processTranscriptText;
          if (!handler) throw new Error("Current provider does not support text transcript");
          await handler.call(session.providerInstance, text, {
            speaker: payload.speaker,
            dialogueRole: payload.dialogueRole,
          });
          acknowledge?.({ ok: true });
        } catch (error) {
          acknowledge?.({ ok: false, error: messageOf(error) });
        }
      }
    );

    socket.on("settings:update", async (payload: SettingsPayload, acknowledge?: Acknowledge) => {
      try {
        const session = requireSession(sessions, payload.sessionId, user.id);
        await sessions.updateSettings(session, {
          source: payload.sourceLanguage?.trim() || undefined,
          target: payload.targetLanguage?.trim() || undefined,
          targets: payload.targetLanguages?.map((item) => item.trim()).filter(Boolean)
        });
        acknowledge?.({ ok: true, data: serializeSession(session) });
      } catch (error) {
        acknowledge?.({ ok: false, error: messageOf(error) });
      }
    });

    socket.on("history:export", (payload: SessionPayload, acknowledge?: Acknowledge) => {
      try {
        const history = sessions.restore(payload.sessionId, user.id);
        if (!history) throw new Error("Session not found");
        acknowledge?.({ ok: true, data: history });
      } catch (error) {
        acknowledge?.({ ok: false, error: messageOf(error) });
      }
    });

    socket.on("reconnect:restore", (payload: SessionPayload, acknowledge?: Acknowledge) => {
      try {
        const session = sessions.restore(payload.sessionId, user.id);
        if (!session) throw new Error("Session not found");
        acknowledge?.({ ok: true, data: session });
      } catch (error) {
        acknowledge?.({ ok: false, error: messageOf(error) });
      }
    });

    socket.on("viewer:join", async (payload: ViewerJoinPayload, acknowledge?: Acknowledge) => {
      try {
        const session = sessions.getPublic(payload.sessionId);
        if (!session || session.state === "stopped") throw new Error("Session not found or ended");
        await socket.join(session.id);
        acknowledge?.({
          ok: true,
          data: {
            sessionId: session.id,
            sourceLanguage: session.sourceLanguage,
            targetLanguages: session.targetLanguages ?? [session.targetLanguage].filter(Boolean),
            history: session.history.slice(-120),
          },
        });
      } catch (error) {
        acknowledge?.({ ok: false, error: messageOf(error) });
      }
    });

    socket.on("share:open", async (payload: ShareOpenPayload, acknowledge?: Acknowledge) => {
      try {
        const sessionId = payload.sessionId?.trim();
        if (!sessionId) throw new Error("Session id is required");
        const targetLanguages = normalizeTargetLanguages(payload);
        const session = await sessions.startRelay({
          userId: user.id,
          sessionId,
          languages: {
            source: payload.sourceLanguage?.trim() || "auto",
            target: targetLanguages[0] || "en",
            targets: targetLanguages,
          },
        });
        await socket.join(session.id);
        acknowledge?.({ ok: true, data: serializeSession(session) });
      } catch (error) {
        acknowledge?.({ ok: false, error: messageOf(error) });
      }
    });

    socket.on("share:push", async (payload: SharePushPayload, acknowledge?: Acknowledge) => {
      try {
        const session = requireSession(sessions, payload.sessionId, user.id);
        if (session.state === "stopped") throw new Error("Session has ended");
        const text = payload.text?.trim();
        if (!text) throw new Error("Text is required");
        if (payload.kind !== "transcript" && payload.kind !== "translation") {
          throw new Error("Unsupported share event");
        }
        const entry: HistoryEntry = {
          id: await createUuid(),
          kind: payload.kind,
          text,
          language: payload.language?.trim() || undefined,
          sourceText: payload.sourceText?.trim() || undefined,
          isFinal: true,
          timestamp: Date.now(),
        };
        await sessions.appendHistory(session, entry);
        if (payload.kind === "transcript") {
          io.to(session.id).emit("transcript", {
            text: entry.text,
            isFinal: true,
            timestamp: entry.timestamp,
          });
        } else {
          io.to(session.id).emit("translation", {
            text: entry.text,
            language: entry.language,
            sourceText: entry.sourceText,
            isFinal: true,
            timestamp: entry.timestamp,
          });
        }
        acknowledge?.({ ok: true });
      } catch (error) {
        acknowledge?.({ ok: false, error: messageOf(error) });
      }
    });

    socket.on(
      "viewer:translate",
      async (
        payload: { sessionId: string; text: string; targetLanguage: string },
        acknowledge?: Acknowledge
      ) => {
        try {
          const session = sessions.getPublic(payload.sessionId);
          if (!session || session.state === "stopped") throw new Error("Session not found or ended");
          const text = payload.text?.trim();
          const target = payload.targetLanguage?.trim();
          if (!text || !target) throw new Error("Text and target language are required");
          const handler = session.providerInstance.processTranscriptText;
          if (!handler) throw new Error("Provider does not support translation");
          const translateOnly = (
            session.providerInstance as { translateText?: (text: string, target: string) => Promise<string> }
          ).translateText;
          if (!translateOnly) throw new Error("On-demand translation unavailable");
          const translated = await translateOnly.call(session.providerInstance, text, target);
          acknowledge?.({ ok: true, data: { text: translated, language: target } });
        } catch (error) {
          acknowledge?.({ ok: false, error: messageOf(error) });
        }
      }
    );

    socket.on("ping", (payload?: unknown) => socket.emit("pong", { payload, timestamp: Date.now() }));
  });
}

function bindProviderEvents(
  io: Server,
  socket: Socket,
  sessions: SessionManager,
  session: TranslationSession
): void {
  session.providerInstance.onTranscript((event) => {
    void recordAndEmit(io, socket, sessions, session, "transcript", event);
  });
  session.providerInstance.onTranslation((event) => {
    void recordAndEmit(io, socket, sessions, session, "translation", event);
  });
  session.providerInstance.onTTS((event) => {
    io.to(session.id).emit("tts:audio", event);
    socket.emit("tts:audio", event);
  });
}

async function recordAndEmit(
  io: Server,
  socket: Socket,
  sessions: SessionManager,
  session: TranslationSession,
  kind: HistoryEntry["kind"],
  event: { text: string; language?: string; isFinal: boolean; timestamp: number }
): Promise<void> {
  const entry: HistoryEntry = { id: await createUuid(), kind, ...event };
  try {
    await sessions.appendHistory(session, entry);
    io.to(session.id).emit(kind, entry);
    socket.emit(kind, entry);
  } catch (error) {
    io.to(session.id).emit("server:error", { error: messageOf(error) });
    socket.emit("server:error", { error: messageOf(error) });
  }
}

async function handleSessionAction(
  socket: Socket,
  sessions: SessionManager,
  payload: SessionPayload,
  acknowledge: Acknowledge | undefined,
  action: (session: TranslationSession) => Promise<void>
): Promise<void> {
  try {
    const user = socket.data.user as AuthUser;
    const session = requireSession(sessions, payload.sessionId, user.id);
    await action(session);
    acknowledge?.({ ok: true, data: serializeSession(session) });
  } catch (error) {
    acknowledge?.({ ok: false, error: messageOf(error) });
  }
}

function requireSession(sessions: SessionManager, sessionId: string, userId: string): TranslationSession {
  const session = sessions.get(sessionId, userId);
  if (!session) throw new Error("Active session not found");
  return session;
}

function serializeSession(session: TranslationSession): Record<string, unknown> {
  return {
    id: session.id,
    state: session.state,
    provider: session.provider,
    sourceLanguage: session.sourceLanguage,
    targetLanguage: session.targetLanguage,
    targetLanguages: session.targetLanguages ?? [session.targetLanguage],
    startedAt: session.startedAt,
    endedAt: session.endedAt,
    status: session.providerInstance.getStatus()
  };
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : "Unexpected server error";
}

function normalizeTargetLanguages(payload: StartPayload): string[] {
  const fromList = payload.targetLanguages?.map((item) => item.trim()).filter(Boolean) ?? [];
  if (fromList.length > 0) return [...new Set(fromList)];
  const single = payload.targetLanguage?.trim();
  return single ? [single] : [];
}

async function createUuid(): Promise<string> {
  const { v4 } = await import("uuid");
  return v4();
}
