import { ChatOpenAI } from 'langchain/chat_models/openai';
import { HumanMessage, SystemMessage } from 'langchain/schema';

const systemPrompt = `You are an expert at creating comprehensive test cases for coding problems.
Your task is to analyze the provided problem statement and generate test cases that cover:
1. Normal cases
2. Edge cases
3. Boundary conditions
4. Error cases

Format your response as a JSON array of test cases, where each test case has:
- input: The input for the test case
- expected: The expected output
- description: Brief description of what this test case checks`;

export async function generateTestCases(problemStatement, modelName = 'gpt-4', additionalInstructions = '') {
  console.log(`[TestCaseGenerator] Generating test cases`, {
    problemLength: problemStatement?.length || 0,
    model: modelName,
    hasAdditionalInstructions: !!additionalInstructions
  });
  
  try {
    const chat = new ChatOpenAI({
      modelName: modelName  
    });
    
    let prompt = `Please analyze the following coding problem and generate comprehensive test cases.`;
    
    if (additionalInstructions) {
      prompt += `\n\nAdditional Instructions for Test Cases:\n${additionalInstructions}`;
    }
    
    prompt += `\n\nProblem Statement:\n${problemStatement}`;
    console.log(`[TestCaseGenerator] Prompt length: ${prompt.length} chars`);
    console.log(`[TestCaseGenerator] Prompt: ${prompt}`);
    const startTime = Date.now();
    console.log(`[TestCaseGenerator] Sending request to ${modelName}...`);
    
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
    
    console.log(`[TestCaseGenerator] Received response from ${modelName} in ${(processingTime / 1000).toFixed(2)}s`);
    console.log(`[TestCaseGenerator] Raw response length: ${response.content?.length || 0} chars`);
    
    try {
      const testCases = JSON.parse(response.content);
      console.log(`[TestCaseGenerator] Successfully parsed ${testCases.length} test cases`);
      return Array.isArray(testCases) ? testCases : [];
    } catch (parseError) {
      console.error('[TestCaseGenerator] Error parsing test cases:', {
        error: parseError.message,
        responseSample: response.content ? response.content.substring(0, 200) + '...' : 'No content'
      });
      throw new Error('Failed to parse test cases from model response');
    }
  } catch (error) {
    console.error('[TestCaseGenerator] Error generating test cases:', {
      error: error.message,
      stack: error.stack,
      problemLength: problemStatement?.length || 0,
      timestamp: new Date().toISOString()
    });
    
    // Return default test cases if parsing fails
    const defaultTestCases = [
      {
        input: '',
        expected: '',
        description: 'Default test case - please provide input and expected output'
      }
    ];
    
    console.log('[TestCaseGenerator] Returning default test cases due to error');
    return defaultTestCases;
  }
}
