import { ChatOpenAI } from 'langchain/chat_models/openai';
import { HumanMessage, SystemMessage } from 'langchain/schema';

const systemPrompt = `You are an expert programming assistant specialized in solving coding problems.
Your task is to analyze the provided problem statement and generate a complete, efficient, and well-documented solution.

Guidelines:
1. Carefully analyze the problem statement, input/output examples, and constraints
2. Generate clean, efficient, and well-commented code
3. Include a brief explanation of your approach
4. Ensure the solution handles edge cases
5. Use appropriate data structures and algorithms
6. Format your response in markdown with code blocks`;

export async function processImage(problemStatement, modelName = 'gpt-5-nano') {
  console.log(`[CodeGenerator] Starting code generation for problem (${problemStatement?.length || 0} chars)`);
  console.log(`[CodeGenerator] Using model: ${modelName}`);
  
  try {
    const chat = new ChatOpenAI({
      modelName: 'gpt-5' // Override parameter to ensure gpt-5-nano is always used
    });

    const prompt = `Please analyze the following coding problem and provide a complete solution with explanation.\n\nProblem Statement:\n${problemStatement}`;
    
    console.log('[CodeGenerator] Sending request to model...');
    const startTime = Date.now();
    
    const response = await chat.invoke([
      new SystemMessage(systemPrompt),
      new HumanMessage({
        content: [
          {
            type: 'text',
            text: prompt
          }
        ]
      })
    ]);

    const endTime = Date.now();
    const processingTime = endTime - startTime;
    
    console.log(`[CodeGenerator] Received response in ${processingTime / 1000} seconds`);
    console.log(`[CodeGenerator] Generated solution length: ${response.content?.length || 0} chars`);
    console.log('[CodeGenerator] First 200 chars of solution:', 
      response.content ? response.content: 'No content');

    return response.content;
  } catch (error) {
    console.error('[CodeGenerator] Error during code generation:', {
      error: error.message,
      stack: error.stack,
      problemLength: problemStatement?.length || 0,
      timestamp: new Date().toISOString()
    });
    throw new Error(`Failed to generate code solution: ${error.message}`);
  }
}
