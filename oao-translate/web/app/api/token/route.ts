import { NextResponse } from "next/server";

const SERVER_URL = process.env.OAO_TRANSLATE_SERVER_URL ?? "http://127.0.0.1:3011";

export async function POST() {
  const userId =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `oao-user-${Date.now()}`;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (process.env.AUTH_API_KEY) {
    headers["x-api-key"] = process.env.AUTH_API_KEY;
  }

  const response = await fetch(`${SERVER_URL}/auth/token`, {
    method: "POST",
    headers,
    body: JSON.stringify({ userId, role: "interpreter" }),
    cache: "no-store",
  });

  if (!response.ok) {
    const detail = await response.text();
    return NextResponse.json(
      { error: "Unable to obtain translation session token", detail },
      { status: response.status }
    );
  }

  const data = (await response.json()) as { token: string };
  return NextResponse.json({ token: data.token });
}
