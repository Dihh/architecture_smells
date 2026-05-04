import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { initDB } from './db.js';
import authRouter from './auth.js';
import { initWebSocket } from './ws.js';

const app = express();
const server = createServer(app);

// Configuration
const PORT = process.env.PORT || 5000;
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || 'http://localhost:5273';

// Middleware
app.use(cors({ 
  origin: FRONTEND_ORIGIN, 
  credentials: true 
}));
app.use(express.json());

// Ensure JSON response headers for all responses
app.use((req, res, next) => {
  res.setHeader('Content-Type', 'application/json');
  next();
});

// Routes
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    timestamp: new Date().toISOString()
  });
});

app.use('/auth', authRouter);

// Initialize WebSocket
initWebSocket(server);

// Start server
const startServer = async () => {
  try {
    await initDB();
    server.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
    });
  } catch (err) {
    console.error('Failed to start server:', err.message);
    process.exit(1);
  }
};

startServer();
