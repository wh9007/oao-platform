const LANGUAGE_CODES: Record<string, string> = {
  "Auto Detect": "auto",
  中文: "zh",
  English: "en",
  日本語: "ja",
  한국어: "ko",
  Français: "fr",
  Deutsch: "de",
  Español: "es",
  Italiano: "it",
  Português: "pt",
  Русский: "ru",
  العربية: "ar",
  ไทย: "th",
  "Tiếng Việt": "vi",
  "Bahasa Indonesia": "id",
  Hindi: "hi",
};

const CODE_LABELS: Record<string, string> = Object.fromEntries(
  Object.entries(LANGUAGE_CODES)
    .filter(([label]) => label !== "Auto Detect")
    .map(([label, code]) => [code, label])
);

export function toLanguageCode(label: string): string {
  return LANGUAGE_CODES[label] ?? label.toLowerCase();
}

export function toLanguageLabel(code: string): string {
  const normalized = (code || "").toLowerCase();
  return CODE_LABELS[normalized] || code;
}

export function toLanguageCodes(labels: string[]): string[] {
  return [...new Set(labels.map((label) => toLanguageCode(label)).filter(Boolean))];
}
