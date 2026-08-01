"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { io, Socket } from "socket.io-client";
import { fetchSocketToken } from "@/lib/api";

type AckResponse = { ok: boolean; error?: string; data?: { id?: string } };

export function useSocket() {
  const ref = useRef<Socket | null>(null);
  const [connected, setConnected] = useState(false);

  const connect = useCallback(async () => {
    if (ref.current?.connected) return;
    const token = await fetchSocketToken();
    const url =
      process.env.NEXT_PUBLIC_SOCKET_URL ??
      (typeof window !== "undefined" ? "http://127.0.0.1:3011" : "");
    const socket = io(url, {
      auth: { token },
      transports: ["websocket", "polling"],
      reconnection: true,
      reconnectionAttempts: Infinity,
    });
    ref.current = socket;
    socket.on("connect", () => setConnected(true));
    socket.on("disconnect", () => setConnected(false));
  }, []);

  const emit = useCallback(
    (event: string, data: unknown, ack?: (response: AckResponse) => void) => {
      if (ack) {
        ref.current?.emit(event, data, ack);
        return;
      }
      ref.current?.emit(event, data);
    },
    []
  );

  const on = useCallback(<T,>(event: string, callback: (data: T) => void) => {
    const handler = callback as (data: unknown) => void;
    ref.current?.on(event, handler);
    return () => {
      ref.current?.off(event, handler);
    };
  }, []);

  useEffect(
    () => () => {
      ref.current?.disconnect();
    },
    []
  );

  return { connected, connect, emit, on };
}
