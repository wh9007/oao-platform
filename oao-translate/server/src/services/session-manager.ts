import { createProvider } from "../providers/factory";
import type {
  ProviderName,
  TranslationLanguages,
  TranslationProvider
} from "../providers/types";
import { HistoryStore, type HistoryEntry, type StoredSession } from "./history-store";

export type SessionState = "active" | "paused" | "stopped";

export interface TranslationSession extends StoredSession {
  state: SessionState;
  providerInstance: TranslationProvider;
}

export interface SessionStartOptions {
  userId: string;
  provider: ProviderName;
  languages: TranslationLanguages;
}

export interface RelayStartOptions {
  userId: string;
  sessionId: string;
  languages: TranslationLanguages;
}

export class SessionManager {
  private readonly sessions = new Map<string, TranslationSession>();

  constructor(private readonly historyStore: HistoryStore) {}

  async start(options: SessionStartOptions): Promise<TranslationSession> {
    const providerInstance = createProvider(options.provider);
    await providerInstance.setLanguages(options.languages);
    const targets =
      options.languages.targets?.filter(Boolean) ??
      [options.languages.target].filter(Boolean);
    const session: TranslationSession = {
      id: await createUuid(),
      userId: options.userId,
      startedAt: Date.now(),
      sourceLanguage: options.languages.source,
      targetLanguage: options.languages.target,
      targetLanguages: targets,
      provider: options.provider,
      history: [],
      state: "active",
      providerInstance
    };
    this.sessions.set(session.id, session);
    await providerInstance.connect();
    await this.persist(session);
    return session;
  }

  get(id: string, userId: string): TranslationSession | undefined {
    const session = this.sessions.get(id);
    return session?.userId === userId ? session : undefined;
  }

  getPublic(id: string): TranslationSession | undefined {
    const session = this.sessions.get(id);
    if (!session || session.state === "stopped") return undefined;
    return session;
  }

  async startRelay(options: RelayStartOptions): Promise<TranslationSession> {
    const existing = this.sessions.get(options.sessionId);
    if (existing) {
      if (existing.userId !== options.userId) {
        throw new Error("Session already owned by another user");
      }
      if (existing.state === "stopped") {
        throw new Error("Session has ended");
      }
      await this.updateSettings(existing, options.languages);
      return existing;
    }
    const providerInstance = createProvider("relay");
    const targets =
      options.languages.targets?.filter(Boolean) ??
      [options.languages.target].filter(Boolean);
    const session: TranslationSession = {
      id: options.sessionId,
      userId: options.userId,
      startedAt: Date.now(),
      sourceLanguage: options.languages.source,
      targetLanguage: options.languages.target,
      targetLanguages: targets,
      provider: "relay",
      history: [],
      state: "active",
      providerInstance,
    };
    await providerInstance.setLanguages(options.languages);
    await providerInstance.connect();
    this.sessions.set(session.id, session);
    await this.persist(session);
    return session;
  }

  async pause(session: TranslationSession): Promise<void> {
    this.assertState(session, "active");
    session.state = "paused";
    await this.persist(session);
  }

  async resume(session: TranslationSession): Promise<void> {
    this.assertState(session, "paused");
    session.state = "active";
    if (!session.providerInstance.getStatus().connected) {
      await session.providerInstance.connect();
    }
    await this.persist(session);
  }

  async stop(session: TranslationSession): Promise<void> {
    if (session.state === "stopped") return;
    session.state = "stopped";
    session.endedAt = Date.now();
    await session.providerInstance.disconnect();
    await this.persist(session);
    this.sessions.delete(session.id);
  }

  async updateSettings(
    session: TranslationSession,
    languages: Partial<TranslationLanguages>
  ): Promise<void> {
    const targets =
      languages.targets ??
      (languages.target ? [languages.target] : session.targetLanguages ?? []).filter(Boolean);
    const updated: TranslationLanguages = {
      source: languages.source ?? session.sourceLanguage,
      target: targets[0] || "",
      targets,
    };
    session.sourceLanguage = updated.source;
    session.targetLanguage = updated.target;
    session.targetLanguages = targets;
    await session.providerInstance.setLanguages(updated);
    await this.persist(session);
  }

  async appendHistory(session: TranslationSession, entry: HistoryEntry): Promise<void> {
    session.history.push(entry);
    if (session.history.length > 1_000) session.history.shift();
    await this.persist(session);
  }

  restore(id: string, userId: string): StoredSession | undefined {
    const active = this.get(id, userId);
    if (active) return this.toStored(active);
    const saved = this.historyStore.get(id);
    return saved?.userId === userId ? saved : undefined;
  }

  async shutdown(): Promise<void> {
    await Promise.all([...this.sessions.values()].map((session) => this.stop(session)));
  }

  private assertState(session: TranslationSession, expected: SessionState): void {
    if (session.state !== expected) {
      throw new Error(`Session must be ${expected}; current state is ${session.state}`);
    }
  }

  private async persist(session: TranslationSession): Promise<void> {
    await this.historyStore.save(this.toStored(session));
  }

  private toStored(session: TranslationSession): StoredSession {
    const { providerInstance: _providerInstance, state: _state, ...stored } = session;
    return structuredClone(stored);
  }
}

async function createUuid(): Promise<string> {
  const { v4 } = await import("uuid");
  return v4();
}
