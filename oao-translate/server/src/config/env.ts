import dotenv from "dotenv";

dotenv.config();

export type NodeEnvironment = "development" | "test" | "production";
export type DefaultProvider = "ollama" | "openai";

export interface Environment {
  PORT: number;
  JWT_SECRET: string;
  OPENAI_API_KEY?: string;
  OPENAI_REALTIME_MODEL: string;
  CORS_ORIGIN: string[];
  NODE_ENV: NodeEnvironment;
  AUTH_API_KEY?: string;
  HISTORY_FILE?: string;
  OLLAMA_BASE_URL: string;
  OLLAMA_CHAT_MODEL: string;
  OLLAMA_WHISPER_MODEL: string;
  OLLAMA_TIMEOUT_MS: number;
  DEFAULT_PROVIDER: DefaultProvider;
}

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function parsePort(value: string | undefined): number {
  const port = Number(value ?? "3001");
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("PORT must be an integer between 1 and 65535");
  }
  return port;
}

function parseNodeEnvironment(value: string | undefined): NodeEnvironment {
  const environment = value ?? "development";
  if (!["development", "test", "production"].includes(environment)) {
    throw new Error("NODE_ENV must be development, test, or production");
  }
  return environment as NodeEnvironment;
}

function parseOrigins(value: string | undefined): string[] {
  const origins = (value ?? "http://localhost:3000")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  if (origins.length === 0) {
    throw new Error("CORS_ORIGIN must contain at least one origin");
  }
  return origins;
}

function parseDefaultProvider(value: string | undefined): DefaultProvider {
  return value === "openai" ? "openai" : "ollama";
}

export const env: Environment = {
  PORT: parsePort(process.env.PORT),
  JWT_SECRET: required("JWT_SECRET"),
  OPENAI_API_KEY: process.env.OPENAI_API_KEY?.trim() || undefined,
  OPENAI_REALTIME_MODEL:
    process.env.OPENAI_REALTIME_MODEL?.trim() || "gpt-4o-realtime-preview",
  CORS_ORIGIN: parseOrigins(process.env.CORS_ORIGIN),
  NODE_ENV: parseNodeEnvironment(process.env.NODE_ENV),
  AUTH_API_KEY: process.env.AUTH_API_KEY?.trim() || undefined,
  HISTORY_FILE: process.env.HISTORY_FILE?.trim() || undefined,
  OLLAMA_BASE_URL: (process.env.OLLAMA_BASE_URL?.trim() || "http://127.0.0.1:11434").replace(/\/$/, ""),
  OLLAMA_CHAT_MODEL: process.env.OLLAMA_CHAT_MODEL?.trim() || "qwen2.5:7b",
  OLLAMA_WHISPER_MODEL: process.env.OLLAMA_WHISPER_MODEL?.trim() || "whisper",
  OLLAMA_TIMEOUT_MS: Number(process.env.OLLAMA_TIMEOUT_MS || "90000"),
  DEFAULT_PROVIDER: parseDefaultProvider(process.env.DEFAULT_PROVIDER)
};