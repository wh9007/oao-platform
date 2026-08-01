import { promises as fs } from "node:fs";
import path from "node:path";

export type HistoryKind = "transcript" | "translation";

export interface HistoryEntry {
  id: string;
  kind: HistoryKind;
  text: string;
  language?: string;
  isFinal: boolean;
  timestamp: number;
}

export interface StoredSession {
  id: string;
  userId: string;
  startedAt: number;
  endedAt?: number;
  sourceLanguage: string;
  targetLanguage: string;
  targetLanguages?: string[];
  provider: string;
  history: HistoryEntry[];
}

export class HistoryStore {
  private readonly sessions = new Map<string, StoredSession>();
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(private readonly filePath?: string) {}

  async load(): Promise<void> {
    if (!this.filePath) return;
    try {
      const content = await fs.readFile(this.filePath, "utf8");
      const records = JSON.parse(content) as StoredSession[];
      records.forEach((session) => this.sessions.set(session.id, session));
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
    }
  }

  async save(session: StoredSession): Promise<void> {
    this.sessions.set(session.id, structuredClone(session));
    await this.persist();
  }

  get(id: string): StoredSession | undefined {
    const session = this.sessions.get(id);
    return session ? structuredClone(session) : undefined;
  }

  listByUser(userId: string): StoredSession[] {
    return [...this.sessions.values()]
      .filter((session) => session.userId === userId)
      .map((session) => structuredClone(session));
  }

  private async persist(): Promise<void> {
    if (!this.filePath) return;
    this.writeQueue = this.writeQueue.then(async () => {
      await fs.mkdir(path.dirname(this.filePath!), { recursive: true });
      const temporaryPath = `${this.filePath}.tmp`;
      await fs.writeFile(temporaryPath, JSON.stringify([...this.sessions.values()]), "utf8");
      await fs.rename(temporaryPath, this.filePath!);
    });
    await this.writeQueue;
  }
}
