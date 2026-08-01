"use client";

import { Dialog, Button } from "./ui";
import { TranscriptLine } from "@/types/session";
import { exportTranscript } from "@/lib/export";

export function ExportDialog({
  open,
  onClose,
  lines,
}: {
  open: boolean;
  onClose: () => void;
  lines: TranscriptLine[];
}) {
  const formats = ["TXT", "Markdown", "PDF", "Word", "CSV", "JSON"] as const;
  return (
    <Dialog open={open} onClose={onClose}>
      <h2 className="text-lg font-semibold">导出会话记录</h2>
      <p className="tx-muted mt-1 text-sm">选择适合的格式，立即下载完整双语转写。</p>
      <div className="mt-5 grid grid-cols-2 gap-2">
        {formats.map((format) => (
          <Button
            key={format}
            variant="outline"
            onClick={() => {
              exportTranscript(lines, format);
              onClose();
            }}
          >
            {format}
          </Button>
        ))}
      </div>
      <Button className="mt-5 w-full" variant="ghost" onClick={onClose}>
        取消
      </Button>
    </Dialog>
  );
}
