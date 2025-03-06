import express from 'express';
import cors from 'cors';
import http from 'http';
import { Server } from 'socket.io';
import OpenAI from 'openai';
import dotenv from 'dotenv';
import { setupSocketHandlers } from './services/chatService.js';

// Load environment variables from .env file
dotenv.config();

/**
 * Creates an Express application and an HTTP server.
 */
const app = express();
const server = http.createServer(app);

/**
 * Configuration options for Cross-Origin Resource Sharing (CORS).
 * Defines allowed origins, methods, headers, and credentials.
 * ! Update the origin URLs to match your frontend application.
 */

const corsOptions = {
  origin: [
    'http://127.0.0.1:5500',
    'http://localhost:5173'
  ],
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type'],
  credentials: true,
};

/**
 * Initializes Socket.IO with the HTTP server and CORS configuration.
 */
const io = new Server(server, { cors: corsOptions });

/**
 * Applies CORS middleware to the Express application.
 */
app.use(cors(corsOptions));

/**
 * Initializes the OpenAI client using the API key from environment variables.
 */
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

/**
 * Sets up Socket.IO connection handling.
 *
 * Listens for 'connection' events and calls the `setupSocketHandlers` function
 * from `chatService.js` to handle socket-specific events.
 */
io.on('connection', (socket) => {
  console.log('New client connected');
  setupSocketHandlers(socket, openai, io);
});

/**
 * Defines a basic health check endpoint.
 *
 * Responds with a 200 status code and a JSON object indicating the server's status.
 */
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

/**
 * Starts the HTTP server and listens on the specified port.
 *
 * The port is determined by the `PORT` environment variable or defaults to 3001.
 */
const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

/**
 * Handles graceful shutdown of the server when a SIGTERM signal is received.
 *
 * Closes the HTTP server and exits the process.
 */
process.on('SIGTERM', () => {
  console.log('SIGTERM signal received: closing HTTP server');
  server.close(() => {
    console.log('HTTP server closed');
    process.exit(0);
  });
});