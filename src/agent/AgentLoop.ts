import type { AgentEvent, AgentOptions, ToolCall } from '../types';
import { ScreenSerializer } from './ScreenSerializer';
import { ToolParser } from './ToolParser';

/**
 * Core agent loop: observe -> think -> act -> repeat.
 *
 * The loop reads the current screen state, asks the LLM to decide what to do,
 * parses tool calls from the response, executes them via the accessibility
 * controller, then observes the new screen state. This continues until the
 * task is complete or the step limit is reached.
 */
export class AgentLoop {
  private options: Required<
    Pick<AgentOptions, 'maxSteps' | 'settleMs'> & AgentOptions
  >;
  private aborted = false;

  constructor(options: AgentOptions) {
    this.options = {
      maxSteps: 20,
      settleMs: 500,
      ...options,
    };
  }

  /**
   * Run the agent loop for a given task. Yields events for each step.
   */
  async *run(task: string): AsyncGenerator<AgentEvent> {
    throw new Error('Not implemented: AgentLoop.run');

    // Implementation outline from the technical plan:
    //
    // let steps = 0;
    // let screenState = await this.readScreen();
    //
    // while (steps < this.options.maxSteps && !this.aborted) {
    //   const prompt = this.buildPrompt(task, screenState, history);
    //   const response = await this.options.provider.generateWithTools(prompt, PHONE_TOOLS);
    //   const toolCalls = ToolParser.parse(response);
    //
    //   for (const call of toolCalls) {
    //     if (call.name === 'task_complete') {
    //       yield { type: 'complete', result: call.arguments.summary as string };
    //       return;
    //     }
    //     yield { type: 'action', tool: call.name, args: call.arguments };
    //     await this.executeToolCall(call);
    //     await this.delay(this.options.settleMs);
    //   }
    //
    //   screenState = await this.readScreen();
    //   steps++;
    //   yield { type: 'observation', screenState, step: steps };
    // }
    //
    // yield { type: 'max_steps_reached' };
  }

  /**
   * Abort the currently running agent loop.
   */
  abort(): void {
    this.aborted = true;
  }

  private async readScreen(): Promise<string> {
    throw new Error('Not implemented: AgentLoop.readScreen');
  }

  private buildPrompt(
    _task: string,
    _screenState: string,
    _history: AgentEvent[],
  ): string {
    throw new Error('Not implemented: AgentLoop.buildPrompt');
  }

  private async executeToolCall(_call: ToolCall): Promise<void> {
    throw new Error('Not implemented: AgentLoop.executeToolCall');
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
