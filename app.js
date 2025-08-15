import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import apiRoutes from './routes/api.js';

// Load environment variables
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Initialize express app
const app = express();
const PORT = process.env.PORT || 5001;

// Configure CORS with specific options
const corsOptions = {
  origin: [
    'http://localhost:3000',
    'http://localhost:5173',
    'https://agentic-code-helper-frontend.vercel.app',
    'https://code-turtle-ai.vercel.app',
    process.env.FRONTEND_URL
  ].filter(Boolean), // This removes any undefined values
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Content-Disposition'],
  credentials: true,
  optionsSuccessStatus: 200
};

// Middleware
app.use(cors(corsOptions));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// API Routes
app.use('/api', apiRoutes);

// Serve static files in production
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(join(__dirname, '../frontend/build')));
  
  app.get('*', (req, res) => {
    res.sendFile(join(__dirname, '../frontend/build/index.html'));
  });
}

// 404 Handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: 'Endpoint not found',
    path: req.path
  });
});

// Global error handler
app.use((err, req, res, next) => {
  console.error('Global error handler:', {
    message: err.message,
    stack: process.env.NODE_ENV === 'development' ? err.stack : undefined,
    path: req.path,
    method: req.method,
    timestamp: new Date().toISOString()
  });

  // Handle different types of errors
  const statusCode = err.statusCode || 500;
  const response = {
    success: false,
    error: err.message || 'Internal Server Error',
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  };

  // Handle JWT errors
  if (err.name === 'JsonWebTokenError') {
    response.error = 'Invalid token';
  } else if (err.name === 'TokenExpiredError') {
    response.error = 'Token expired';
  }

  res.status(statusCode).json(response);
});

// Start server
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});

export default app;
