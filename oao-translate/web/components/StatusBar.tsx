"use client";

export function StatusBar({
  connected,
  recording,
  localMode = true,
}: {
  connected: boolean;
  recording: boolean;
  localMode?: boolean;
}) {
  const status = connected ? "已连接" : "等待服务";
  return (
    <div className="tx-muted flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
      <span className="flex items-center gap-1.5">
        <i className={`h-2 w-2 rounded-full ${connected ? "bg-emerald-500" : "bg-zinc-400"}`} />
        {status}
      </span>
      <span>{localMode ? "本地 Ollama · 零 Token" : "云端 API"}</span>
      <span className={recording ? "tx-accent font-semibold" : ""}>
        {recording ? "● 麦克风监听中" : "○ 麦克风待命"}
      </span>
    </div>
  );
}
