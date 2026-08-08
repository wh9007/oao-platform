import http from "node:http";
import path from "node:path";
import cors from "cors";
import express, { type NextFunction, type Request, type Response } from "express";
import helmet from "helmet";
import { Server } from "socket.io";
import { requireJwt, requireSocketJwt, type AuthenticatedRequest } from "./auth/jwt";
import { env } from "./config/env";
import { authRouter } from "./routes/auth";
import { healthRouter } from "./routes/health";
import { HistoryStore } from "./services/history-store";
import { SessionManager } from "./services/session-manager";
import { registerSocketHandlers } from "./socket/handlers";

export async function createApplication(): Promise<{
  app: express.Express;
  server: http.Server;
  io: Server;
  sessions: SessionManager;
}> {
  const historyStore = new HistoryStore(
    env.HISTORY_FILE ? path.resolve(env.HISTORY_FILE) : undefined
  );
  await historyStore.load();

  const app = express();
  app.disable("x-powered-by");
  app.use(helmet());
  app.use(
    cors({
      origin(origin, callback) {
        if (!origin || env.CORS_ORIGIN.includes(origin)) {
          callback(null, true);
          return;
        }
        callback(new Error("Origin is not allowed by CORS"));
      }
    })
  );
  app.use(express.json({ limit: "1mb" }));
  app.use("/health", healthRouter);
  app.use("/auth", authRouter);
  app.get("/api/me", requireJwt, (request: AuthenticatedRequest, response) => {
    response.json({ user: request.user });
  });
  app.use((_request, response) => response.status(404).json({ error: "Not found" }));
  app.use((error: Error, _request: Request, response: Response, _next: NextFunction) => {
    console.error(error);
    response.status(500).json({ error: "Internal server error" });
  });

  const server = http.createServer(app);
  const io = new Server(server, {
    cors: {
      origin: env.CORS_ORIGIN,
      methods: ["GET", "POST"]
    }
  });
  io.use(requireSocketJwt);

  const sessions = new SessionManager(historyStore);
  registerSocketHandlers(io, sessions);
  return { app, server, io, sessions };
}

async function bootstrap(): Promise<void> {
  const { server, io, sessions } = await createApplication();
  let shuttingDown = false;
  const shutdown = (signal: string): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.info(`Received ${signal}; shutting down`);
    io.close(() => {
      void sessions.shutdown().finally(() => {
        server.close(() => process.exit(0));
      });
    });
  };

  process.once("SIGINT", () => shutdown("SIGINT"));
  process.once("SIGTERM", () => shutdown("SIGTERM"));
  server.listen(env.PORT, () => {
    console.info(`OAO Translate server listening on port ${env.PORT}`);
  });
}

if (require.main === module) {
  void bootstrap().catch((error: unknown) => {
    console.error("Failed to start OAO Translate server", error);
    process.exit(1);
  });
}
