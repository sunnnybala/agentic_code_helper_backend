import express from 'express';
import multer from 'multer';
import { processImages } from '../agents/ocrProcessor.js';
import { processImage } from '../agents/codeGenerator.js';
import { generateTestCases } from '../agents/testCaseGenerator.js';
import { evaluateSolutions } from '../agents/solutionEvaluator.js';

// Store active clients for SSE
const clients = new Map();

const router = express.Router();

// SSE endpoint for progress updates
router.get('/progress', (req, res) => {
  const clientId = Date.now();
  const newClient = {
    id: clientId,
    res
  };

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

// Helper function to send progress updates to all clients
const sendProgressUpdate = (update) => {
  const data = `data: ${JSON.stringify(update)}\n\n`;
  clients.forEach(client => {
    client.res.write(data);
  });
};

// Configure multer for file uploads
const storage = multer.memoryStorage();
const upload = multer({ 
  storage: storage,
  limits: { files: 3 } // Allow up to 3 files
});

// Upload and process images
router.post('/upload', upload.array('images', 3), async (req, res) => {
  const requestId = Date.now().toString(36) + Math.random().toString(36).substr(2);
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

    try {
      console.log(`[API] [${requestId}] Starting OCR processing...`);
      
      const problemStatement = await processImages(imagesData);
      console.log(`[API] [${requestId}] OCR processing completed, problem statement length:`, problemStatement?.length || 0);
      sendProgressUpdate({ imageProcessed: true });
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
      sendProgressUpdate({ codeGenerated: true });
      
      // Then wait for test case generation to complete
      const testCases = await testCasesPromise;
      sendProgressUpdate({ testCasesGenerated: true });

      console.log(`[API] [${requestId}] Solutions and test cases generated, evaluating solutions with model: ${model}...`);
      const bestSolution = await evaluateSolutions(
        [solution1, solution2, solution3], 
        testCases,
        model
      );
      console.log(`[API] [${requestId}] Solution evaluation completed`);
      sendProgressUpdate({ solutionSelected: true });

      const response = {
        success: true,
        solution: bestSolution,
        testCases,
        problemStatement,
        requestId,
        timestamp: new Date().toISOString()
      };

      console.log(`[API] [${requestId}] Request completed successfully`);
      
      // Close all client connections after completion
      clients.forEach(client => {
        client.res.end();
      });
      clients.clear();
      
      return res.json(response);
      
    } catch (processingError) {
      console.error(`[API] [${requestId}] Error during processing:`, {
        error: processingError.message,
        stack: processingError.stack,
        timestamp: new Date().toISOString()
      });
      
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
