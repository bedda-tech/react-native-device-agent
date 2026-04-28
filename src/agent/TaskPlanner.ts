import type { AgentEvent, AgentOptions, LLMProviderInterface } from '../types';
import { AgentLoop } from './AgentLoop';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * A single step in a decomposed task plan.
 */
export interface SubTask {
  /** Zero-based position in the plan. */
  index: number;
  /** Natural-language description of what to do in this step. */
  description: string;
}

/**
 * Events emitted by TaskPlanner during planning and execution.
 */
export type PlannerEvent =
  | { type: 'plan'; subtasks: SubTask[] }
  | { type: 'subtask_start'; subtask: SubTask }
  | { type: 'subtask_complete'; subtask: SubTask; result: string }
  | { type: 'subtask_error'; subtask: SubTask; error: Error }
  | { type: 'agent_event'; subtask: SubTask; event: AgentEvent }
  | { type: 'complete'; result: string }
  | { type: 'error'; error: Error };

/**
 * Options for the task planner. Extends AgentOptions so the same provider
 * config is reused for both planning and execution.
 */
export interface TaskPlannerOptions extends AgentOptions {
  /**
   * Maximum number of subtasks to decompose a complex task into.
   * Default: 5.
   */
  maxSubTasks?: number;
}

// ---------------------------------------------------------------------------
// Prompt
// ---------------------------------------------------------------------------

const DECOMPOSE_PROMPT = `You are a task decomposer for an Android phone agent.
Given a high-level task, break it into a numbered list of simple, concrete subtasks.
Each subtask must be completable in a single short agent session (a few taps or swipes).
Output ONLY a numbered list, one subtask per line, nothing else.

Example input: Set an alarm for 7 AM tomorrow
Example output:
1. Open the Clock app
2. Navigate to the Alarms tab
3. Tap the add alarm button and set the time to 7:00 AM
4. Save the alarm`;

// ---------------------------------------------------------------------------
// TaskPlanner
// ---------------------------------------------------------------------------

/**
 * Decomposes a complex task into ordered subtasks and executes each one in
 * sequence using AgentLoop. Yields PlannerEvents so callers can stream
 * progress to the user.
 *
 * Usage:
 * ```ts
 * const planner = new TaskPlanner({ provider, maxSteps: 10, maxSubTasks: 5 });
 * for await (const event of planner.run('Send a WhatsApp message to Alice saying hi')) {
 *   if (event.type === 'plan') console.log('Plan:', event.subtasks);
 *   if (event.type === 'complete') console.log('Done:', event.result);
 * }
 * ```
 */
export class TaskPlanner {
  private options: TaskPlannerOptions & { maxSubTasks: number };
  private _aborted = false;
  private _currentLoop: AgentLoop | null = null;

  constructor(options: TaskPlannerOptions) {
    this.options = {
      maxSubTasks: 5,
      ...options,
    };
  }

  /**
   * Abort the currently-running subtask and prevent any further subtasks from
   * starting. Safe to call before, during, or after `run()`.
   */
  abort(): void {
    this._aborted = true;
    this._currentLoop?.abort();
  }

  /**
   * Run the planner for a given high-level task.
   *
   * Yields:
   *  - 'plan'             when the LLM has decomposed the task
   *  - 'subtask_start'    before each subtask begins
   *  - 'agent_event'      forwarding every AgentLoop event for the subtask
   *  - 'subtask_complete' when a subtask finishes successfully
   *  - 'subtask_error'    when a subtask fails (execution continues)
   *  - 'complete'         when all subtasks have been attempted
   *  - 'error'            if decomposition itself fails
   */
  async *run(task: string): AsyncGenerator<PlannerEvent> {
    this._aborted = false;

    // Step 1: Decompose into subtasks
    let subtasks: SubTask[];
    try {
      subtasks = await this.decompose(task, this.options.provider);
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      yield { type: 'error', error };
      return;
    }

    // Fallback: run the whole task as one step if decomposition returned nothing
    if (subtasks.length === 0) {
      subtasks = [{ index: 0, description: task }];
    }

    yield { type: 'plan', subtasks };

    // Step 2: Execute each subtask sequentially
    const results: string[] = [];

    for (const subtask of subtasks) {
      if (this._aborted) break;

      yield { type: 'subtask_start', subtask };

      const loop = new AgentLoop(this.options);
      this._currentLoop = loop;
      let subtaskResult = '';
      let hadError = false;

      try {
        for await (const event of loop.run(subtask.description)) {
          yield { type: 'agent_event', subtask, event };

          if (event.type === 'complete') {
            subtaskResult = event.result;
          } else if (event.type === 'error') {
            hadError = true;
            yield { type: 'subtask_error', subtask, error: event.error };
            break;
          } else if (event.type === 'failed') {
            hadError = true;
            yield { type: 'subtask_error', subtask, error: new Error(event.reason) };
            break;
          } else if (event.type === 'timeout') {
            hadError = true;
            yield { type: 'subtask_error', subtask, error: new Error('Subtask timed out.') };
            break;
          } else if (event.type === 'max_steps_reached') {
            subtaskResult = `Step limit reached for: ${subtask.description}`;
          }
        }
      } catch (err) {
        hadError = true;
        const error = err instanceof Error ? err : new Error(String(err));
        yield { type: 'subtask_error', subtask, error };
      } finally {
        this._currentLoop = null;
      }

      if (!hadError && !this._aborted) {
        const result = subtaskResult || `Completed: ${subtask.description}`;
        results.push(result);
        yield { type: 'subtask_complete', subtask, result };
      }
    }

    const finalResult = results.join(' ') || 'All subtasks completed.';
    yield { type: 'complete', result: finalResult };
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  private async decompose(
    task: string,
    provider: LLMProviderInterface,
  ): Promise<SubTask[]> {
    const prompt = `${DECOMPOSE_PROMPT}\n\nTask: ${task}\n\nSubtasks:`;
    const response = await provider.generate(prompt);
    return this.parseSubTasks(response);
  }

  private parseSubTasks(response: string): SubTask[] {
    const lines = response
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);

    const subtasks: SubTask[] = [];

    for (const line of lines) {
      // Match "1. Do something" or "1) Do something"
      const match = line.match(/^(\d+)[.)]\s+(.+)$/);
      if (match) {
        const index = parseInt(match[1]!, 10) - 1;
        const description = match[2]!.trim();
        if (description && subtasks.length < this.options.maxSubTasks) {
          subtasks.push({ index, description });
        }
      }
    }

    return subtasks;
  }
}
