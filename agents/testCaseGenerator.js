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

export async function generateTestCases(problemStatement) {
  console.log(`[TestCaseGenerator] Generating test cases for problem (${problemStatement?.length || 0} chars)`);
  
  try {
    const chat = new ChatOpenAI({
      modelName: 'gpt-5'
    });

    console.log('[TestCaseGenerator] Model initialized: gpt-5');
    
    const prompt = `Please analyze the following coding problem and generate comprehensive test cases.\n\nProblem Statement:\n${problemStatement}`;
    
    console.log('[TestCaseGenerator] Sending request to model...');
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
    
    console.log(`[TestCaseGenerator] Received response in ${processingTime / 1000} seconds`);
    console.log('[TestCaseGenerator] Raw response length:', response.content?.length || 0);
    
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
