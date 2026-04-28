import { TaskPlanner } from '../src/agent/TaskPlanner';
import type { LLMProviderInterface, Tool } from '../src/types';

// ---------------------------------------------------------------------------
// Mock the native peer dependency (required by AgentLoop)
// ---------------------------------------------------------------------------

const mockController = {
  getAccessibilityTree: jest.fn().mockResolvedValue({
    nodeId: 'root',
    text: 'Home screen',
    children: [],
  }),
  tapNode: jest.fn().mockResolvedValue(true),
  tap: jest.fn().mockResolvedValue(true),
  setNodeText: jest.fn().mockResolvedValue(true),
  swipe: jest.fn().mockResolvedValue(true),
  scrollNode: jest.fn().mockResolvedValue(true),
  openApp: jest.fn().mockResolvedValue(true),
  globalAction: jest.fn().mockResolvedValue(true),
  takeScreenshot: jest.fn().mockResolvedValue('/tmp/screenshot.png'),
};

jest.mock('react-native-accessibility-controller', () => mockController, {
  virtual: true,
});

// ---------------------------------------------------------------------------
// Provider helpers
// ---------------------------------------------------------------------------

/**
 * Provider that returns a numbered subtask list from generate() (decompose)
 * and immediately completes from generateWithTools() (AgentLoop execution).
 */
function makeDecomposeProvider(
  subtaskLines: string,
  completionSummary = 'Done.',
): LLMProviderInterface {
  return {
    async generate(_prompt: string): Promise<string> {
      return subtaskLines;
    },
    async generateWithTools(_prompt: string, _tools: Tool[]): Promise<string> {
      return `{"name":"task_complete","arguments":{"summary":"${completionSummary}"}}`;
    },
  };
}

/**
 * Provider whose generate() throws — simulates LLM failure during decompose.
 */
const errorOnDecomposeProvider: LLMProviderInterface = {
  async generate(_prompt: string): Promise<string> {
    throw new Error('Decompose failed');
  },
  async generateWithTools(_prompt: string, _tools: Tool[]): Promise<string> {
    return '{"name":"task_complete","arguments":{"summary":"ok"}}';
  },
};

/**
 * Provider that returns an empty string for decompose — should trigger fallback.
 */
const emptyDecomposeProvider: LLMProviderInterface = {
  async generate(_prompt: string): Promise<string> {
    return '';
  },
  async generateWithTools(_prompt: string, _tools: Tool[]): Promise<string> {
    return '{"name":"task_complete","arguments":{"summary":"fallback done"}}';
  },
};

/**
 * Provider that decomposes fine but throws during AgentLoop execution.
 */
function makeFailingExecutionProvider(subtaskLines: string): LLMProviderInterface {
  return {
    async generate(_prompt: string): Promise<string> {
      return subtaskLines;
    },
    async generateWithTools(_prompt: string, _tools: Tool[]): Promise<string> {
      throw new Error('Execution failed');
    },
  };
}

// ---------------------------------------------------------------------------
// Helper to collect all events from a planner run
// ---------------------------------------------------------------------------

async function collectEvents(
  planner: TaskPlanner,
  task: string,
): Promise<Array<{ type: string } & Record<string, unknown>>> {
  const events: Array<{ type: string } & Record<string, unknown>> = [];
  for await (const event of planner.run(task)) {
    events.push(event as { type: string } & Record<string, unknown>);
  }
  return events;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('TaskPlanner', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockController.getAccessibilityTree.mockResolvedValue({
      nodeId: 'root',
      text: 'Home screen',
      children: [],
    });
  });

  describe('successful decomposition and execution', () => {
    it('emits a plan event with parsed subtasks', async () => {
      const provider = makeDecomposeProvider(
        '1. Open the Clock app\n2. Navigate to Alarms\n3. Tap add alarm',
      );
      const planner = new TaskPlanner({ provider, maxSteps: 5, settleMs: 0 });

      const events = await collectEvents(planner, 'Set an alarm for 7 AM');

      const planEvent = events.find((e) => e.type === 'plan');
      expect(planEvent).toBeDefined();
      expect((planEvent as unknown as { subtasks: unknown[] }).subtasks).toHaveLength(3);
      expect(
        (planEvent as unknown as { subtasks: Array<{ index: number; description: string }> }).subtasks[0],
      ).toEqual({ index: 0, description: 'Open the Clock app' });
    });

    it('emits subtask_start before each subtask', async () => {
      const provider = makeDecomposeProvider('1. Do step one\n2. Do step two');
      const planner = new TaskPlanner({ provider, maxSteps: 5, settleMs: 0 });

      const events = await collectEvents(planner, 'Two step task');

      const startEvents = events.filter((e) => e.type === 'subtask_start');
      expect(startEvents).toHaveLength(2);
    });

    it('emits subtask_complete after each successful subtask', async () => {
      const provider = makeDecomposeProvider(
        '1. First step\n2. Second step',
        'subtask done',
      );
      const planner = new TaskPlanner({ provider, maxSteps: 5, settleMs: 0 });

      const events = await collectEvents(planner, 'Two subtasks');

      const completeEvents = events.filter((e) => e.type === 'subtask_complete');
      expect(completeEvents).toHaveLength(2);
      expect(
        (completeEvents[0] as unknown as { result: string }).result,
      ).toBe('subtask done');
    });

    it('emits a final complete event with joined subtask results', async () => {
      const provider = makeDecomposeProvider('1. Step one\n2. Step two', 'done');
      const planner = new TaskPlanner({ provider, maxSteps: 5, settleMs: 0 });

      const events = await collectEvents(planner, 'Task');

      const completeEvent = events.find((e) => e.type === 'complete');
      expect(completeEvent).toBeDefined();
      // Result should contain content from both subtasks
      expect(typeof (completeEvent as unknown as { result: string }).result).toBe('string');
    });

    it('forwards agent_event entries for each subtask', async () => {
      const provider = makeDecomposeProvider('1. Only step');
      const planner = new TaskPlanner({ provider, maxSteps: 5, settleMs: 0 });

      const events = await collectEvents(planner, 'Single step');

      const agentEvents = events.filter((e) => e.type === 'agent_event');
      expect(agentEvents.length).toBeGreaterThan(0);
      // Each agent_event should reference the owning subtask
      for (const ae of agentEvents) {
        expect((ae as unknown as { subtask: unknown }).subtask).toBeDefined();
      }
    });
  });

  describe('maxSubTasks option', () => {
    it('respects maxSubTasks and trims excess subtasks', async () => {
      const provider = makeDecomposeProvider(
        '1. A\n2. B\n3. C\n4. D\n5. E\n6. F',
      );
      const planner = new TaskPlanner({ provider, maxSteps: 5, settleMs: 0, maxSubTasks: 3 });

      const events = await collectEvents(planner, 'Big task');

      const planEvent = events.find((e) => e.type === 'plan');
      expect(
        (planEvent as unknown as { subtasks: unknown[] }).subtasks,
      ).toHaveLength(3);
    });

    it('defaults maxSubTasks to 5', async () => {
      const provider = makeDecomposeProvider(
        '1. A\n2. B\n3. C\n4. D\n5. E\n6. F\n7. G',
      );
      const planner = new TaskPlanner({ provider, maxSteps: 5, settleMs: 0 });

      const events = await collectEvents(planner, 'Big task defaults');

      const planEvent = events.find((e) => e.type === 'plan');
      expect(
        (planEvent as unknown as { subtasks: unknown[] }).subtasks,
      ).toHaveLength(5);
    });
  });

  describe('fallback when decompose returns nothing', () => {
    it('runs the whole task as a single subtask when decomposition is empty', async () => {
      const planner = new TaskPlanner({
        provider: emptyDecomposeProvider,
        maxSteps: 5,
        settleMs: 0,
      });

      const events = await collectEvents(planner, 'My fallback task');

      const planEvent = events.find((e) => e.type === 'plan');
      expect(planEvent).toBeDefined();
      const subtasks = (planEvent as unknown as { subtasks: Array<{ description: string }> }).subtasks;
      expect(subtasks).toHaveLength(1);
      expect(subtasks[0].description).toBe('My fallback task');
    });

    it('still emits complete after the fallback subtask runs', async () => {
      const planner = new TaskPlanner({
        provider: emptyDecomposeProvider,
        maxSteps: 5,
        settleMs: 0,
      });

      const events = await collectEvents(planner, 'Fallback');

      const completeEvent = events.find((e) => e.type === 'complete');
      expect(completeEvent).toBeDefined();
    });
  });

  describe('error handling', () => {
    it('emits error event when decompose throws', async () => {
      const planner = new TaskPlanner({
        provider: errorOnDecomposeProvider,
        maxSteps: 5,
        settleMs: 0,
      });

      const events = await collectEvents(planner, 'Will fail to decompose');

      const errorEvent = events.find((e) => e.type === 'error');
      expect(errorEvent).toBeDefined();
      expect(
        (errorEvent as unknown as { error: Error }).error.message,
      ).toBe('Decompose failed');
    });

    it('does not emit plan or complete when decompose throws', async () => {
      const planner = new TaskPlanner({
        provider: errorOnDecomposeProvider,
        maxSteps: 5,
        settleMs: 0,
      });

      const events = await collectEvents(planner, 'Fail fast');

      expect(events.find((e) => e.type === 'plan')).toBeUndefined();
      expect(events.find((e) => e.type === 'complete')).toBeUndefined();
    });

    it('emits subtask_error when a subtask execution fails, then continues to complete', async () => {
      const provider = makeFailingExecutionProvider('1. Step one\n2. Step two');
      const planner = new TaskPlanner({ provider, maxSteps: 5, settleMs: 0 });

      const events = await collectEvents(planner, 'Error in execution');

      const subtaskErrors = events.filter((e) => e.type === 'subtask_error');
      expect(subtaskErrors.length).toBeGreaterThan(0);

      // Planner should still emit complete even when subtasks fail
      const completeEvent = events.find((e) => e.type === 'complete');
      expect(completeEvent).toBeDefined();
    });
  });

  describe('abort()', () => {
    it('skips remaining subtasks after abort() is called between subtasks', async () => {
      const provider = makeDecomposeProvider('1. First step\n2. Second step\n3. Third step');
      const planner = new TaskPlanner({ provider, maxSteps: 5, settleMs: 0 });

      const events: Array<{ type: string } & Record<string, unknown>> = [];
      let aborted = false;
      for await (const event of planner.run('Three step task')) {
        events.push(event as typeof events[0]);
        // Abort after the first subtask completes — second and third should be skipped
        if (event.type === 'subtask_complete' && !aborted) {
          aborted = true;
          planner.abort();
        }
      }

      const startEvents = events.filter((e) => e.type === 'subtask_start');
      expect(startEvents).toHaveLength(1);
    });

    it('still emits a complete event after abort', async () => {
      const provider = makeDecomposeProvider('1. Step one\n2. Step two\n3. Step three');
      const planner = new TaskPlanner({ provider, maxSteps: 5, settleMs: 0 });

      const events: Array<{ type: string } & Record<string, unknown>> = [];
      let aborted = false;
      for await (const event of planner.run('Abort mid-run')) {
        events.push(event as typeof events[0]);
        if (event.type === 'subtask_complete' && !aborted) {
          aborted = true;
          planner.abort();
        }
      }

      expect(events.find((e) => e.type === 'complete')).toBeDefined();
    });

    it('can be restarted with a fresh run() after abort', async () => {
      const provider = makeDecomposeProvider('1. Step A\n2. Step B');
      const planner = new TaskPlanner({ provider, maxSteps: 5, settleMs: 0 });

      // First run — abort after plan
      let events1: Array<{ type: string } & Record<string, unknown>> = [];
      let aborted = false;
      for await (const event of planner.run('First run')) {
        events1.push(event as typeof events1[0]);
        if (event.type === 'subtask_complete' && !aborted) {
          aborted = true;
          planner.abort();
        }
      }

      // Second run — should run to completion without being pre-aborted
      const events2 = await collectEvents(planner, 'Second run');
      const completeEvent = events2.find((e) => e.type === 'complete');
      expect(completeEvent).toBeDefined();
      // Both subtasks should have run
      expect(events2.filter((e) => e.type === 'subtask_start')).toHaveLength(2);
    });
  });

  describe('subtask failed and timeout handling', () => {
    afterEach(() => jest.restoreAllMocks());

    it('emits subtask_error when subtask calls task_failed, then continues to complete', async () => {
      // First subtask calls task_failed; second subtask completes normally.
      let callCount = 0;
      const provider: LLMProviderInterface = {
        async generate(_prompt: string): Promise<string> {
          return '1. Failing step\n2. Success step';
        },
        async generateWithTools(_prompt: string, _tools: Tool[]): Promise<string> {
          callCount++;
          if (callCount === 1) {
            // First subtask's AgentLoop: signal failure
            return '{"name":"task_failed","arguments":{"reason":"Cannot proceed."}}';
          }
          // Second subtask's AgentLoop: complete normally
          return '{"name":"task_complete","arguments":{"summary":"step 2 done"}}';
        },
      };

      const planner = new TaskPlanner({ provider, maxSteps: 5, settleMs: 0 });
      const events = await collectEvents(planner, 'Two step task');

      const subtaskErrors = events.filter((e) => e.type === 'subtask_error');
      expect(subtaskErrors).toHaveLength(1);
      expect(
        (subtaskErrors[0] as unknown as { error: Error }).error.message,
      ).toBe('Cannot proceed.');

      // Second subtask should still complete
      const subtaskCompletes = events.filter((e) => e.type === 'subtask_complete');
      expect(subtaskCompletes).toHaveLength(1);

      // Planner still emits a final complete event
      expect(events.find((e) => e.type === 'complete')).toBeDefined();
    });

    it('emits subtask_error when subtask times out, then continues to complete', async () => {
      let dateCalls = 0;
      jest.spyOn(Date, 'now').mockImplementation(() => {
        dateCalls++;
        // AgentLoop 1: call 1 = startTime (0), call 2 = timeout check (10_000) → fires
        // AgentLoop 2+: all remaining calls return 0 → no timeout
        if (dateCalls === 1) return 0;
        if (dateCalls === 2) return 10_000;
        return 0;
      });

      let callCount = 0;
      const provider: LLMProviderInterface = {
        async generate(_prompt: string): Promise<string> {
          return '1. Timing out step\n2. Fast step';
        },
        async generateWithTools(_prompt: string, _tools: Tool[]): Promise<string> {
          callCount++;
          if (callCount <= 1) {
            // First subtask's AgentLoop: keep running (tap) so timeout check fires
            return '{"name":"tap","arguments":{"nodeId":"x"}}';
          }
          return '{"name":"task_complete","arguments":{"summary":"step 2 done"}}';
        },
      };

      const planner = new TaskPlanner({ provider, maxSteps: 5, settleMs: 0, timeoutMs: 5000 });
      const events = await collectEvents(planner, 'Timeout task');

      const subtaskErrors = events.filter((e) => e.type === 'subtask_error');
      expect(subtaskErrors).toHaveLength(1);
      expect(
        (subtaskErrors[0] as unknown as { error: Error }).error.message,
      ).toBe('Subtask timed out.');

      // Second subtask should still run
      expect(events.find((e) => e.type === 'complete')).toBeDefined();
    });

    it('does not incorrectly emit subtask_complete when task_failed is called', async () => {
      const provider: LLMProviderInterface = {
        async generate(_prompt: string): Promise<string> {
          return '1. The only step';
        },
        async generateWithTools(_prompt: string, _tools: Tool[]): Promise<string> {
          return '{"name":"task_failed","arguments":{"reason":"blocked"}}';
        },
      };

      const planner = new TaskPlanner({ provider, maxSteps: 5, settleMs: 0 });
      const events = await collectEvents(planner, 'Single failing task');

      expect(events.filter((e) => e.type === 'subtask_complete')).toHaveLength(0);
      expect(events.filter((e) => e.type === 'subtask_error')).toHaveLength(1);
    });
  });

  describe('subtask parsing', () => {
    it('parses numbered list with dot separator (1. text)', async () => {
      const provider = makeDecomposeProvider('1. Open app\n2. Tap button');
      const planner = new TaskPlanner({ provider, maxSteps: 5, settleMs: 0 });
      const events = await collectEvents(planner, 'parse test');

      const plan = events.find((e) => e.type === 'plan') as
        | { subtasks: Array<{ description: string }> }
        | undefined;
      expect(plan?.subtasks[0]?.description).toBe('Open app');
    });

    it('parses numbered list with parenthesis separator (1) text)', async () => {
      const provider = makeDecomposeProvider('1) First thing\n2) Second thing');
      const planner = new TaskPlanner({ provider, maxSteps: 5, settleMs: 0 });
      const events = await collectEvents(planner, 'paren parse test');

      const plan = events.find((e) => e.type === 'plan') as
        | { subtasks: Array<{ description: string }> }
        | undefined;
      expect(plan?.subtasks).toHaveLength(2);
      expect(plan?.subtasks[0]?.description).toBe('First thing');
    });

    it('ignores blank lines and non-numbered lines between steps', async () => {
      const provider = makeDecomposeProvider(
        'Here are the steps:\n1. Step one\n\n2. Step two\nSome extra text\n3. Step three',
      );
      const planner = new TaskPlanner({ provider, maxSteps: 5, settleMs: 0 });
      const events = await collectEvents(planner, 'noisy list');

      const plan = events.find((e) => e.type === 'plan') as
        | { subtasks: unknown[] }
        | undefined;
      expect(plan?.subtasks).toHaveLength(3);
    });
  });
});
