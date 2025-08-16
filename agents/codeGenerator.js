import { ChatOpenAI } from 'langchain/chat_models/openai';
import { HumanMessage, SystemMessage } from 'langchain/schema';

const systemPrompt = `You are an expert programming assistant specialized in solving coding problems.
Your task is to analyze the provided problem statement and generate a complete, efficient, and well-documented solution.
Do not include a main method or any test harness. Only complete the function within the existing class Solution.

Guidelines:
1. Carefully analyze the problem statement, input/output examples, and constraints
2. Generate clean, efficient, and well-commented code
3. Include a brief explanation of your approach
4. Ensure the solution handles edge cases
5. Use appropriate data structures and algorithms
6. Format your response in markdown with code blocks

Example Prompt Input:
----------------------
Given the problem: "Return the sum of two integers."

class Solution:
    def add(self, a: int, b: int) -> int:

----------------------

Your completion should be:

class Solution:
    def add(self, a: int, b: int) -> int:
        return a + b

Do not add main or any test code
`;

export async function processImage(problemStatement, modelName = 'gpt-4', additionalInstructions = '') {
  console.log(`[CodeGenerator] Starting code generation`, {
    problemLength: problemStatement?.length || 0,
    model: modelName,
    hasAdditionalInstructions: !!additionalInstructions
  });
  
  try {
    const chat = new ChatOpenAI({
      modelName: modelName
    });

    let prompt = `Please analyze the following coding problem and provide a complete solution with explanation.`;
    
    if (additionalInstructions) {
      prompt += `\n\nAdditional Instructions:\n${additionalInstructions}`;
    }
    
    prompt += `\n\nProblem Statement:\n${problemStatement}`;
    console.log(`[CodeGenerator] Prompt length: ${prompt.length} chars`);
    console.log(`[CodeGenerator] Prompt: ${prompt}`);
    const startTime = Date.now();
    console.log(`[CodeGenerator] Sending request to ${modelName}...`);
    
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
    
    console.log(`[CodeGenerator] Received response from ${modelName} in ${(processingTime / 1000).toFixed(2)}s`);
    console.log(`[CodeGenerator] Generated solution length: ${response.content?.length || 0} chars`);

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
