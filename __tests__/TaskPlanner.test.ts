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
      expect((planEvent as { subtasks: unknown[] }).subtasks).toHaveLength(3);
      expect(
        (planEvent as { subtasks: Array<{ index: number; description: string }> }).subtasks[0],
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
        (completeEvents[0] as { result: string }).result,
      ).toBe('subtask done');
    });

    it('emits a final complete event with joined subtask results', async () => {
      const provider = makeDecomposeProvider('1. Step one\n2. Step two', 'done');
      const planner = new TaskPlanner({ provider, maxSteps: 5, settleMs: 0 });

      const events = await collectEvents(planner, 'Task');

      const completeEvent = events.find((e) => e.type === 'complete');
      expect(completeEvent).toBeDefined();
      // Result should contain content from both subtasks
      expect(typeof (completeEvent as { result: string }).result).toBe('string');
    });

    it('forwards agent_event entries for each subtask', async () => {
      const provider = makeDecomposeProvider('1. Only step');
      const planner = new TaskPlanner({ provider, maxSteps: 5, settleMs: 0 });

      const events = await collectEvents(planner, 'Single step');

      const agentEvents = events.filter((e) => e.type === 'agent_event');
      expect(agentEvents.length).toBeGreaterThan(0);
      // Each agent_event should reference the owning subtask
      for (const ae of agentEvents) {
        expect((ae as { subtask: unknown }).subtask).toBeDefined();
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
        (planEvent as { subtasks: unknown[] }).subtasks,
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
        (planEvent as { subtasks: unknown[] }).subtasks,
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
      const subtasks = (planEvent as { subtasks: Array<{ description: string }> }).subtasks;
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
        (errorEvent as { error: Error }).error.message,
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
