import type { NextFunction, Request, Response } from "express";
import jwt, { type JwtPayload, type SignOptions } from "jsonwebtoken";
import type { Socket } from "socket.io";
import { env } from "../config/env";

export interface AuthUser {
  id: string;
  role?: string;
}

export interface AuthenticatedRequest extends Request {
  user?: AuthUser;
}

function toUser(payload: string | JwtPayload): AuthUser {
  if (typeof payload === "string" || typeof payload.sub !== "string") {
    throw new Error("JWT subject is required");
  }
  return { id: payload.sub, role: typeof payload.role === "string" ? payload.role : undefined };
}

export function signToken(user: AuthUser, expiresIn = "12h"): string {
  const options: SignOptions = {
    subject: user.id,
    expiresIn: expiresIn as SignOptions["expiresIn"]
  };
  return jwt.sign({ role: user.role }, env.JWT_SECRET, options);
}

export function verifyToken(token: string): AuthUser {
  return toUser(jwt.verify(token, env.JWT_SECRET));
}

function extractBearerToken(value: string | undefined): string | undefined {
  if (!value?.startsWith("Bearer ")) {
    return undefined;
  }
  return value.slice("Bearer ".length).trim() || undefined;
}

export function requireJwt(
  request: AuthenticatedRequest,
  response: Response,
  next: NextFunction
): void {
  try {
    const token = extractBearerToken(request.header("authorization"));
    if (!token) {
      response.status(401).json({ error: "Missing bearer token" });
      return;
    }
    request.user = verifyToken(token);
    next();
  } catch {
    response.status(401).json({ error: "Invalid or expired token" });
  }
}

export function requireSocketJwt(socket: Socket, next: (error?: Error) => void): void {
  try {
    const token =
      typeof socket.handshake.auth.token === "string"
        ? socket.handshake.auth.token
        : extractBearerToken(socket.handshake.headers.authorization);
    if (!token) {
      next(new Error("Missing socket authentication token"));
      return;
    }
    socket.data.user = verifyToken(token);
    next();
  } catch {
    next(new Error("Invalid or expired socket authentication token"));
  }
}
