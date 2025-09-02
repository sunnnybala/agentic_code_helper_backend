import express from 'express';
import multer from 'multer';
import { processImages } from '../agents/ocrProcessor.js';
import { processImage } from '../agents/codeGenerator.js';
import { generateTestCases } from '../agents/testCaseGenerator.js';
import { evaluateSolutions } from '../agents/solutionEvaluator.js';
import { requireAuth } from '../middlewares/auth.js';
import { getRequiredCredits, debitCredits, creditCredits } from '../services/credits.js';

// Store active clients for SSE
// client shape: { id, res, subscriptions: Set<requestId>, userId? }
const clients = new Map();

const router = express.Router();

// SSE endpoint for progress updates
// Supports short-lived token-based authentication via `?token=...` so the
// client can connect cross-origin without relying on cookies being sent by
// EventSource.
router.get('/progress', async (req, res) => {
  const clientId = Date.now();
  // Allow clients to subscribe to a particular requestId via query param
  const subscribeTo = req.query.requestId || null;
  const token = req.query.token || null;

  const newClient = {
    id: clientId,
    res,
    subscriptions: new Set(subscribeTo ? [subscribeTo] : []),
    userId: null
  };

  // If a token is provided, verify and associate userId
  if (token) {
    try {
      // Use ESM imports: import verifyToken from utils at top-level.
      // Lazily import to avoid circular dependency issues.
      const { verifyToken } = await import('../utils/jwt.js');
      const payload = verifyToken(token);
      // only accept tokens with expected shape and purpose
      if (!payload || !payload.uid) return res.status(401).end();
      newClient.userId = payload.uid;
    } catch (e) {
      return res.status(401).end();
    }
  } else if (process.env.NODE_ENV === 'production') {
    // In production require token-based auth for SSE to avoid relying on
    // cross-site cookies which are not reliably sent by EventSource.
    return res.status(401).end();
  }

  // Set headers for SSE
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive'
  });

  // Store the client
  clients.set(clientId, newClient);

  // Remove client on connection close
  req.on('close', () => {
    clients.delete(clientId);
  });
});

// Helper function to send progress updates
// If requestId is provided, only send to clients subscribed to that requestId
const sendProgressUpdate = (update, requestId = null) => {
  const data = `data: ${JSON.stringify(update)}\n\n`;
  clients.forEach(client => {
    if (!requestId) {
      client.res.write(data);
      return;
    }
    if (client.subscriptions && client.subscriptions.has(requestId)) {
      client.res.write(data);
    }
  });
};

// Configure multer for file uploads
const storage = multer.memoryStorage();
const upload = multer({ 
  storage: storage,
  limits: { files: 3 } // Allow up to 3 files
});

// Upload and process images
router.post('/upload', requireAuth, upload.array('images', 3), async (req, res) => {
  const providedRequestId = req.body?.requestId;
  const requestId = providedRequestId || Date.now().toString(36) + Math.random().toString(36).substr(2);
  const model = req.body.model || 'gpt-4';
  const additionalInstructions = req.body.additionalInstructions || '';
  
  console.log(`[API] [${requestId}] New upload request received`, {
    files: req.files?.length || 0,
    model,
    hasAdditionalInstructions: !!additionalInstructions
  });
  
  try {
    if (!req.files || req.files.length === 0) {
      console.error(`[API] [${requestId}] No files provided`);
      return res.status(400).json({ 
        success: false,
        error: 'No image files provided',
        requestId
      });
    }

    if (req.files.length > 3) {
      console.error(`[API] [${requestId}] Too many files:`, req.files.length);
      return res.status(400).json({ 
        success: false,
        error: 'Maximum of 3 images allowed',
        requestId
      });
    }

    console.log(`[API] [${requestId}] Processing ${req.files.length} images...`);
    
    // Convert all images to base64
    const imagesData = req.files.map((file, index) => {
      const imageBase64 = file.buffer.toString('base64');
      const mimeType = file.mimetype;
      const data = `data:${mimeType};base64,${imageBase64}`;
      console.log(`[API] [${requestId}] Processed image ${index + 1}, size: ${data.length} chars`);
      return data;
    });

    let debited = false;
    try {
      const required = getRequiredCredits(model);
      try {
        await debitCredits(req.user.id, required, `model:${model}`, requestId);
        debited = true;
      } catch (debitErr) {
        // Surface insufficient credits to the client with a 402 status
        if (debitErr && (debitErr.statusCode === 402 || /insufficient/i.test(debitErr.message || ''))) {
          console.log(`[API] [${requestId}] Insufficient credits for user ${req.user?.id}`);
          return res.status(402).json({ success: false, error: 'Insufficient credits', details: debitErr.message, requestId });
        }
        // rethrow other debit errors
        throw debitErr;
      }
      console.log(`[API] [${requestId}] Starting OCR processing...`);
      
      console.log(`[API] [${requestId}] Sending ${imagesData.length} images to OCR processor`);
      const problemStatement = await processImages(imagesData);
      console.log(`[API] [${requestId}] OCR processor returned, length: ${problemStatement?.length || 0}`);
      console.log(`[API] [${requestId}] OCR processing completed, problem statement length:`, problemStatement?.length || 0);
      sendProgressUpdate({ imageProcessed: true }, requestId);
      console.log(`[API] [${requestId}] Starting parallel generation of solutions and test cases...`);
      console.log(`[API] [${requestId}] Generating solutions with model: ${model}`);
      
      // Start both code generation and test case generation in parallel
      const solutionPromises = [
        processImage(problemStatement, model, additionalInstructions),
        processImage(problemStatement, model, additionalInstructions),
        processImage(problemStatement, model, additionalInstructions)
      ];
      
      const testCasesPromise = generateTestCases(problemStatement, model, additionalInstructions);
      
      // Wait for code generation to complete first
      const [solution1, solution2, solution3] = await Promise.all(solutionPromises);
      console.log(`[API] [${requestId}] Received ${[solution1, solution2, solution3].filter(Boolean).length} solutions`);
      sendProgressUpdate({ codeGenerated: true }, requestId);
      
      // Then wait for test case generation to complete
      const testCases = await testCasesPromise;
      console.log(`[API] [${requestId}] Received test cases: ${Array.isArray(testCases) ? testCases.length : 'unknown'}`);
      sendProgressUpdate({ testCasesGenerated: true }, requestId);

      console.log(`[API] [${requestId}] Solutions and test cases generated, evaluating solutions with model: ${model}...`);
      const bestSolution = await evaluateSolutions(
        [solution1, solution2, solution3], 
        testCases,
        model
      );
      console.log(`[API] [${requestId}] Best solution selected`);
      console.log(`[API] [${requestId}] Solution evaluation completed`);
      sendProgressUpdate({ solutionSelected: true }, requestId);

      const response = {
        success: true,
        solution: bestSolution,
        testCases,
        problemStatement,
        requestId,
        timestamp: new Date().toISOString()
      };

      console.log(`[API] [${requestId}] Request completed successfully`);
      // Notify only subscribers for this requestId that the job is complete
      sendProgressUpdate({ event: 'completed', requestId, timestamp: new Date().toISOString() }, requestId);
      // Do not forcibly end all SSE connections — let clients decide to disconnect.
      return res.json(response);
      
    } catch (processingError) {
      console.error(`[API] [${requestId}] Error during processing:`, {
        error: processingError.message,
        stack: processingError.stack,
        timestamp: new Date().toISOString()
      });
      
      if (debited) {
        try { await creditCredits(req.user.id, getRequiredCredits(model), `refund:${requestId}`, requestId); } catch (_) {}
      }
      return res.status(500).json({
        success: false,
        error: 'Failed to process images',
        details: processingError.message,
        requestId
      });
    }
  } catch (error) {
    console.error(`[API] [${requestId}] Unexpected error:`, {
      error: error.message,
      stack: error.stack,
      timestamp: new Date().toISOString()
    });
    
    return res.status(500).json({
      success: false,
      error: 'An unexpected error occurred',
      details: error.message,
      requestId
    });
  }
});

export default router;
