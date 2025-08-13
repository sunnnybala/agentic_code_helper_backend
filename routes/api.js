import express from 'express';
import multer from 'multer';
import { processImages } from '../agents/ocrProcessor.js';
import { processImage } from '../agents/codeGenerator.js';
import { generateTestCases } from '../agents/testCaseGenerator.js';
import { evaluateSolutions } from '../agents/solutionEvaluator.js';

const router = express.Router();

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

      console.log(`[API] [${requestId}] Starting parallel generation of solutions and test cases...`);
      console.log(`[API] [${requestId}] Generating solutions with model: ${model}`);
      const solutionPromises = [
        processImage(problemStatement, model, additionalInstructions),
        processImage(problemStatement, model, additionalInstructions),
        processImage(problemStatement, model, additionalInstructions)
      ];
      
      console.log(`[API] [${requestId}] Starting parallel generation of solutions and test cases...`);
      const [solution1, solution2, solution3, testCases] = await Promise.all([
        ...solutionPromises,
        generateTestCases(problemStatement, model, additionalInstructions)
      ]);

      console.log(`[API] [${requestId}] Solutions and test cases generated, evaluating solutions with model: ${model}...`);
      const bestSolution = await evaluateSolutions(
        [solution1, solution2, solution3], 
        testCases,
        model
      );
      console.log(`[API] [${requestId}] Solution evaluation completed`);

      const response = {
        success: true,
        solution: bestSolution,
        testCases,
        problemStatement,
        requestId,
        timestamp: new Date().toISOString()
      };

      console.log(`[API] [${requestId}] Request completed successfully`);
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
