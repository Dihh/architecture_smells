import cors from "cors";
import express from "express";
import { createServer } from "node:http";
import { initializeDatabase } from "./database.js";
import authRouter from "./routes/auth.js";
import { initializeWebSocketServer } from "./websocket.js";

const app = express();
const PORT = process.env.PORT || 5000;
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || "http://localhost:5273";

const db = initializeDatabase();
app.locals.db = db;

app.use(cors({ origin: FRONTEND_ORIGIN, credentials: true }));
app.use(express.json());
app.use((req, res, next) => {
  res.type("application/json");
  next();
});

app.get("/health", (req, res) => {
  res.status(200).json({
    status: "ok",
    timestamp: new Date().toISOString(),
  });
});

app.use("/auth", authRouter);

app.use((req, res) => {
  res.status(404).json({ error: "Not found" });
});

app.use((err, req, res, next) => {
  if (res.headersSent) {
    return next(err);
  }

  if (err instanceof SyntaxError && err.status === 400 && "body" in err) {
    return res.status(400).json({ error: "Invalid JSON" });
  }

  return res.status(500).json({ error: "Internal server error" });
});

const server = createServer(app);

initializeWebSocketServer(server, db);

server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
