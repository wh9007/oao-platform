import { Router } from "express";
import { signToken } from "../auth/jwt";
import { env } from "../config/env";

export const authRouter = Router();

authRouter.post("/token", (request, response) => {
  const apiKey = request.header("x-api-key");
  if (env.AUTH_API_KEY && apiKey !== env.AUTH_API_KEY) {
    response.status(401).json({ error: "Invalid API key" });
    return;
  }

  const userId = typeof request.body?.userId === "string" ? request.body.userId.trim() : "";
  const role = typeof request.body?.role === "string" ? request.body.role.trim() : undefined;
  if (!userId) {
    response.status(400).json({ error: "userId is required" });
    return;
  }

  response.status(201).json({
    token: signToken({ id: userId, role }),
    tokenType: "Bearer"
  });
});
