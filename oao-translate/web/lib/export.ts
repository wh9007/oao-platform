import { TranscriptLine } from "@/types/session";

type ExportFormat = "TXT" | "Markdown" | "PDF" | "Word" | "CSV" | "JSON";

function formatTranslations(line: TranscriptLine): string {
  if (line.translations?.length) {
    return line.translations.map((item) => `[${item.label}] ${item.text}`).join("\n");
  }
  return line.translation;
}

const text = (lines: TranscriptLine[]) =>
  lines.map((line) => `[${line.time}] ${line.source}\n${formatTranslations(line)}`).join("\n\n");

const csv = (lines: TranscriptLine[]) =>
  [
    "Time,Language,Original,Translation",
    ...lines.map((line) =>
      [line.time, line.language, line.source, formatTranslations(line)]
        .map((value) => `"${value.replaceAll('"', '""')}"`)
        .join(",")
    ),
  ].join("\n");

export function exportTranscript(lines: TranscriptLine[], format: ExportFormat) {
  const raw =
    format === "JSON"
      ? JSON.stringify(lines, null, 2)
      : format === "CSV"
        ? csv(lines)
        : format === "Markdown"
          ? lines
              .map(
                (line) =>
                  `### ${line.time} · ${line.language}\n${line.source}\n\n> ${formatTranslations(line).replaceAll("\n", "\n> ")}`
              )
              .join("\n\n")
          : text(lines);
  const payload =
    format === "PDF"
      ? `%PDF-1.3\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Count 1/Kids[3 0 R]>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Contents 4 0 R>>endobj\n4 0 obj<</Length ${raw.length + 40}>>stream\nBT /F1 12 Tf 45 740 Td (${raw.replace(/[()\\]/g, "")}) Tj ET\nendstream endobj\ntrailer<</Root 1 0 R>>\n%%EOF`
      : format === "Word"
        ? `<html><body><pre>${raw}</pre></body></html>`
        : raw;
  const type =
    format === "PDF"
      ? "application/pdf"
      : format === "Word"
        ? "application/msword"
        : "text/plain;charset=utf-8";
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([payload], { type }));
  a.download = `oao-translate.${format === "Markdown" ? "md" : format.toLowerCase()}`;
  a.click();
  URL.revokeObjectURL(a.href);
}
