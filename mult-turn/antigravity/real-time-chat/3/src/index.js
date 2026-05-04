import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import http from 'http';
import { initDB } from './db.js';
import authRoutes from './routes/auth.js';
import { initSocketServer } from './socket.js';

dotenv.config();

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 5000;
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || "http://localhost:5273";

// --- Middleware ---
app.use(cors({ origin: FRONTEND_ORIGIN, credentials: true }));
app.use(express.json());

// --- Routes ---

/**
 * Health Check Endpoint
 */
app.get('/health', (req, res) => {
  res.status(200).json({
    status: "ok",
    timestamp: new Date().toISOString()
  });
});

/**
 * Authentication Routes
 */
app.use('/auth', authRoutes);

// --- Server Initialization ---

const startServer = async () => {
  try {
    // Initialize the SQLite database
    await initDB();
    console.log('✅ Database connected and schema ready');

    // Initialize WebSocket Server
    initSocketServer(server);
    console.log('🔌 WebSocket server initialized');

    server.listen(PORT, () => {
      console.log(`🚀 Server is flying on port ${PORT}`);
      console.log(`📡 Accepting requests from ${FRONTEND_ORIGIN}`);
    });
  } catch (error) {
    console.error('❌ Failed to start the server:', error);
    process.exit(1);
  }
};

startServer();
