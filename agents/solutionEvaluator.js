import { ChatOpenAI } from 'langchain/chat_models/openai';
import { HumanMessage, SystemMessage } from 'langchain/schema';

const systemPrompt = `You are an expert at evaluating code solutions for programming problems.
Your task is to analyze multiple solutions to the same problem and select the best one based on these criteria (in order of importance):
1. Correctness (must pass all test cases)
2. Efficiency (time and space complexity)
3. Code quality and readability
4. Edge case handling
5. Documentation and comments
6. Brevity (fewer lines of code is better, but not at the expense of clarity)

Your response should include:
1. A detailed analysis of each solution's strengths and weaknesses
2. A clear explanation of why the selected solution is the best
3. The final code in a well-formatted code block
4. Time and space complexity analysis
5. Any potential improvements or optimizations`;

export async function evaluateSolutions(solutions, testCases) {
  try {
    if (!solutions?.length) {
      throw new Error('No solutions provided for evaluation');
    }

    console.log('[SolutionEvaluator] Starting evaluation of', solutions.length, 'solutions');
    console.log('[SolutionEvaluator] Test cases:', JSON.stringify(testCases, null, 2));
    
    const chat = new ChatOpenAI({
      modelName: 'gpt-5'
    });

    console.log('[SolutionEvaluator] Model initialized:', 'gpt-5');

    const evaluationPrompt = `## Test Cases
${JSON.stringify(testCases, null, 2)}

## Solutions to Evaluate
${solutions.map((sol, i) => `### Solution ${i + 1}
${sol}\n`).join('\n')}

Please evaluate the solutions above and provide:
1. Detailed analysis of each solution
2. Your selected best solution with clear reasoning
3. The final code in a well-formatted code block
4. Time and space complexity analysis`;

    console.log('[SolutionEvaluator] Sending evaluation request to model...');
    const startTime = Date.now();
    
    const response = await chat.invoke([
      new SystemMessage(systemPrompt),
      new HumanMessage({
        content: [
          {
            type: 'text',
            text: evaluationPrompt
          }
        ]
      })
    ]);

    const endTime = Date.now();
    console.log(`[SolutionEvaluator] Received response in ${(endTime - startTime) / 1000} seconds`);
    console.log('[SolutionEvaluator] Raw response:', JSON.stringify(response, null, 2));

    const result = {
      bestSolution: response.content,
      analysis: `Analysis completed. Evaluated ${solutions.length} solutions.`,
      timestamp: new Date().toISOString(),
      model: 'gpt-5-nano',
      evaluationTimeMs: endTime - startTime
    };

    console.log('[SolutionEvaluator] Evaluation completed successfully');
    console.log('[SolutionEvaluator] Result summary:', {
      solutionLength: result.bestSolution?.length || 0,
      timestamp: result.timestamp,
      evaluationTimeMs: result.evaluationTimeMs
    });

    return result;
  } catch (error) {
    console.error('[SolutionEvaluator] Error during evaluation:', {
      error: error.message,
      stack: error.stack,
      solutionsCount: solutions?.length || 0,
      testCasesCount: testCases?.length || 0,
      timestamp: new Date().toISOString()
    });
    
    const fallbackSolution = solutions?.[0] || 'No valid solution was generated';
    console.log('[SolutionEvaluator] Using fallback solution:', {
      hasFallback: !!solutions?.[0],
      fallbackLength: fallbackSolution.length
    });
    
    return {
      bestSolution: fallbackSolution,
      analysis: `Error during evaluation: ${error.message}. Showing first solution as fallback.`,
      error: true,
      timestamp: new Date().toISOString(),
      model: 'gpt-5-nano',
      isFallback: true
    };
  }
}
