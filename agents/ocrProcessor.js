import { ChatOpenAI } from 'langchain/chat_models/openai';
import { HumanMessage, SystemMessage } from 'langchain/schema';

const systemPrompt = `You are an expert at extracting and formatting coding problems from images.
Your task is to analyze the provided images of coding problems and convert them into a well-structured text format.

Guidelines:
1. Carefully analyze all images to understand the complete problem
2. Extract the problem statement, constraints, and any examples
3. Format the output in a clear, organized markdown format
4. Include any test cases or examples provided in the images
5. If there are multiple images, combine the information logically
6. Preserve all important details and requirements from the original problem`;

export async function processImages(imagesData) {
  try {
    console.log('[OCRProcessor] Starting image processing for', imagesData.length, 'images');
    
    const chat = new ChatOpenAI({
      modelName: 'gpt-5-nano'
    });

    console.log('[OCRProcessor] Model initialized: gpt-5-nano');

    // Prepare image content for the API
    const imageContents = imagesData.map((imageData, index) => {
      console.log(`[OCRProcessor] Processing image ${index + 1}, size: ${imageData.length} chars`);
      return {
        type: 'image_url',
        image_url: { 
          url: imageData,
          detail: 'high'  // Request high detail for better OCR accuracy
        }
      };
    });

    console.log('[OCRProcessor] Sending OCR request to model...');
    const startTime = Date.now();
    
    try {
      const response = await chat.invoke([
        new SystemMessage(systemPrompt),
        new HumanMessage({
          content: [
            {
              type: 'text',
              text: 'Please extract and format the coding problem from these images into a well-structured text format.'
            },
            ...imageContents
          ]
        })
      ]);

      const endTime = Date.now();
      const processingTime = endTime - startTime;
      
      console.log(`[OCRProcessor] Received response in ${processingTime / 1000} seconds`);
      console.log('[OCRProcessor] Extracted content length:', response.content?.length || 0);
      console.log('[OCRProcessor] First 200 chars of extracted content:', 
        response.content ? response.content: 'No content');
      
      return response.content;
    } catch (error) {
      console.error('[OCRProcessor] Error during OCR processing:', {
        error: error.message,
        stack: error.stack,
        imagesProcessed: imageContents.length,
        timestamp: new Date().toISOString()
      });
      throw error;
    }
  } catch (error) {
    console.error('Error in OCR processing:', error);
    throw new Error('Failed to process images with OCR');
  }
}
