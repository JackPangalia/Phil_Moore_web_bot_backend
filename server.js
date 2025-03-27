import express from 'express';
import cors from 'cors';
import http from 'http';
import { Server } from 'socket.io';
import OpenAI from 'openai';
import dotenv from 'dotenv';
import { setupSocketHandlers } from './services/chatService.js';
import { initScraperService, runScraper } from './services/scraperService.js';

// Load environment variables from .env file
dotenv.config();

const app = express();
const server = http.createServer(app);

const corsOptions = {
  origin: [
    'http://127.0.0.1:5500',
    'http://localhost:5173'
  ],
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type', 'Origin'],
  credentials: true,
};

const io = new Server(server, { 
  cors: corsOptions,
  transports: ['websocket', 'polling'],
  allowEIO3: true
});

app.use(cors(corsOptions));
app.use(express.json());

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Initialize scraper service
initScraperService();

io.on('connection', (socket) => {
  console.log('New client connected');
  setupSocketHandlers(socket, openai, io);
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

// Endpoint to manually trigger the scraper
app.post('/api/scrape', async (req, res) => {
  try {
    console.log('Manual scraper execution triggered via API');
    const listings = await runScraper();
    res.status(200).json({ 
      status: 'success', 
      message: `Scraped ${listings.length} listings` 
    });
  } catch (error) {
    console.error('Error during manual scraper execution:', error);
    res.status(500).json({ 
      status: 'error', 
      message: 'Failed to run scraper', 
      error: error.message 
    });
  }
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

process.on('SIGTERM', () => {
  console.log('SIGTERM signal received: closing HTTP server');
  server.close(() => {
    console.log('HTTP server closed');
    process.exit(0);
  });
});