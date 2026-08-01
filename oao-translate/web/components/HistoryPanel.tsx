import { HistorySession } from "@/types/session";

export function HistoryPanel({
  sessions,
  onOpen,
}: {
  sessions: HistorySession[];
  onOpen: (session: HistorySession) => void;
}) {
  return (
    <aside className="surface-panel rounded-xl p-4">
      <div className="mb-3 flex justify-between">
        <h2 className="text-sm font-semibold">会话历史</h2>
        <span className="tx-muted text-xs">{sessions.length} 项</span>
      </div>
      {sessions.length === 0 ? (
        <p className="tx-muted py-5 text-center text-sm">完成的会话将安全保存在这里</p>
      ) : (
        <div className="space-y-2">
          {sessions.map((session) => (
            <button
              onClick={() => onOpen(session)}
              key={session.id}
              className="theme-btn-outline w-full rounded-lg p-3 text-left transition"
            >
              <p className="truncate text-sm">{session.title}</p>
              <p className="tx-muted mt-1 text-xs">
                {session.date} · {session.duration}
              </p>
            </button>
          ))}
        </div>
      )}
    </aside>
  );
}
