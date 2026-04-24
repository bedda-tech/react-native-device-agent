import { AgentLoop } from '../src/agent/AgentLoop';
import type { LLMProviderInterface, Tool, AgentEvent } from '../src/types';

// ---------------------------------------------------------------------------
// Mock react-native-accessibility-controller
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
  takeScreenshot: jest.fn().mockResolvedValue('/tmp/screen.png'),
};

jest.mock('react-native-accessibility-controller', () => mockController, {
  virtual: true,
});

// ---------------------------------------------------------------------------
// Provider helpers
// ---------------------------------------------------------------------------

/** Provider that immediately signals task_complete. */
function makeCompletingProvider(summary = 'Done.'): LLMProviderInterface {
  return {
    async generate(): Promise<string> {
      return '';
    },
    async generateWithTools(): Promise<string> {
      return `{"name":"task_complete","arguments":{"summary":"${summary}"}}`;
    },
  };
}

/** Provider that taps a node, then completes on the next call. */
function makeTapThenCompleteProvider(nodeId = 'btn-1'): LLMProviderInterface {
  let call = 0;
  return {
    async generate(): Promise<string> {
      return '';
    },
    async generateWithTools(): Promise<string> {
      call++;
      if (call === 1) {
        return `{"name":"tap","arguments":{"nodeId":"${nodeId}"}}`;
      }
      return `{"name":"task_complete","arguments":{"summary":"tapped and done"}}`;
    },
  };
}

/** Provider that always throws during generateWithTools. */
const errorProvider: LLMProviderInterface = {
  async generate(): Promise<string> {
    return '';
  },
  async generateWithTools(): Promise<string> {
    throw new Error('LLM unavailable');
  },
};

/** Provider that returns plain text (no tool call) every time — causes max_steps. */
function makePlainTextProvider(): LLMProviderInterface {
  return {
    async generate(): Promise<string> {
      return '';
    },
    async generateWithTools(): Promise<string> {
      return 'I am thinking about what to do...';
    },
  };
}

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

async function collectEvents(loop: AgentLoop, task: string): Promise<AgentEvent[]> {
  const events: AgentEvent[] = [];
  for await (const event of loop.run(task)) {
    events.push(event);
  }
  return events;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AgentLoop', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockController.getAccessibilityTree.mockResolvedValue({
      nodeId: 'root',
      text: 'Home screen',
      children: [],
    });
  });

  describe('immediate task_complete', () => {
    it('emits a complete event with the summary', async () => {
      const loop = new AgentLoop({
        provider: makeCompletingProvider('All done!'),
        maxSteps: 5,
        settleMs: 0,
      });

      const events = await collectEvents(loop, 'Open Settings');

      const complete = events.find((e) => e.type === 'complete');
      expect(complete).toBeDefined();
      expect((complete as { type: 'complete'; result: string }).result).toBe('All done!');
    });

    it('does not emit max_steps_reached when task completes', async () => {
      const loop = new AgentLoop({
        provider: makeCompletingProvider(),
        maxSteps: 5,
        settleMs: 0,
      });

      const events = await collectEvents(loop, 'Quick task');

      expect(events.find((e) => e.type === 'max_steps_reached')).toBeUndefined();
    });
  });

  describe('multi-step execution', () => {
    it('emits an action event before completing', async () => {
      const loop = new AgentLoop({
        provider: makeTapThenCompleteProvider('some-node'),
        maxSteps: 5,
        settleMs: 0,
      });

      const events = await collectEvents(loop, 'Tap then finish');

      const action = events.find((e) => e.type === 'action');
      expect(action).toBeDefined();
      expect((action as { type: 'action'; tool: string }).tool).toBe('tap');
    });

    it('calls tapNode on the controller with the correct nodeId', async () => {
      const loop = new AgentLoop({
        provider: makeTapThenCompleteProvider('my-button'),
        maxSteps: 5,
        settleMs: 0,
      });

      await collectEvents(loop, 'Tap my button');

      expect(mockController.tapNode).toHaveBeenCalledWith('my-button');
    });

    it('reads the accessibility tree at the start and after each action', async () => {
      const loop = new AgentLoop({
        provider: makeTapThenCompleteProvider(),
        maxSteps: 5,
        settleMs: 0,
      });

      await collectEvents(loop, 'Multi-step');

      // Initial read + one post-action read
      expect(mockController.getAccessibilityTree).toHaveBeenCalledTimes(2);
    });

    it('emits an observation event after each action step', async () => {
      const loop = new AgentLoop({
        provider: makeTapThenCompleteProvider(),
        maxSteps: 5,
        settleMs: 0,
      });

      const events = await collectEvents(loop, 'Observe after tap');

      const obs = events.find((e) => e.type === 'observation');
      expect(obs).toBeDefined();
      expect((obs as { type: 'observation'; step: number }).step).toBe(1);
    });
  });

  describe('max steps', () => {
    it('emits max_steps_reached when the provider never calls task_complete', async () => {
      const loop = new AgentLoop({
        provider: makePlainTextProvider(),
        maxSteps: 2,
        settleMs: 0,
      });

      const events = await collectEvents(loop, 'Infinite loop task');

      const maxSteps = events.find((e) => e.type === 'max_steps_reached');
      expect(maxSteps).toBeDefined();
    });

    it('emits exactly maxSteps observation events before stopping', async () => {
      const loop = new AgentLoop({
        provider: makePlainTextProvider(),
        maxSteps: 3,
        settleMs: 0,
      });

      const events = await collectEvents(loop, 'Count steps');

      const observations = events.filter((e) => e.type === 'observation');
      expect(observations).toHaveLength(3);
    });
  });

  describe('abort', () => {
    it('stops the loop early when abort() is called between yields', async () => {
      const loop = new AgentLoop({
        provider: makeTapThenCompleteProvider(),
        maxSteps: 10,
        settleMs: 0,
      });

      loop.abort();
      const events = await collectEvents(loop, 'Aborted task');

      // Loop was aborted before starting — should produce no events (error on
      // initial screen read is possible, or it stops in the while condition).
      const complete = events.find((e) => e.type === 'complete');
      expect(complete).toBeUndefined();
    });
  });

  describe('error handling', () => {
    it('emits an error event when the LLM provider throws', async () => {
      const loop = new AgentLoop({
        provider: errorProvider,
        maxSteps: 3,
        settleMs: 0,
      });

      const events = await collectEvents(loop, 'LLM will fail');

      const error = events.find((e) => e.type === 'error');
      expect(error).toBeDefined();
      expect((error as { type: 'error'; error: Error }).error.message).toBe('LLM unavailable');
    });

    it('emits an error event when getAccessibilityTree throws', async () => {
      mockController.getAccessibilityTree.mockRejectedValueOnce(
        new Error('Service not connected'),
      );

      const loop = new AgentLoop({
        provider: makeCompletingProvider(),
        maxSteps: 3,
        settleMs: 0,
      });

      const events = await collectEvents(loop, 'Screen read fails');

      const error = events.find((e) => e.type === 'error');
      expect(error).toBeDefined();
      expect(
        (error as { type: 'error'; error: Error }).error.message,
      ).toContain('Service not connected');
    });

    it('continues after a tool execution error rather than aborting', async () => {
      mockController.tapNode.mockRejectedValueOnce(new Error('Tap failed'));

      const loop = new AgentLoop({
        provider: makeTapThenCompleteProvider('bad-node'),
        maxSteps: 5,
        settleMs: 0,
      });

      const events = await collectEvents(loop, 'Handle tap error');

      // Should emit an error for the failed tap but then continue to complete
      const errors = events.filter((e) => e.type === 'error');
      expect(errors.length).toBeGreaterThan(0);

      const complete = events.find((e) => e.type === 'complete');
      expect(complete).toBeDefined();
    });
  });

  describe('retryOnError', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    /** Helper: runs the agent loop while also advancing fake timers so delays
     *  inside inferWithRetry don't block the test. */
    async function collectWithTimers(loop: AgentLoop, task: string): Promise<AgentEvent[]> {
      const events: AgentEvent[] = [];
      const gen = loop.run(task);
      let done = false;
      while (!done) {
        const nextPromise = gen.next();
        await jest.runAllTimersAsync();
        const result = await nextPromise;
        if (result.done) {
          done = true;
        } else {
          events.push(result.value);
        }
      }
      return events;
    }

    it('retries once and succeeds when retryOnError=1 and first call fails', async () => {
      let calls = 0;
      const flakeyProvider: LLMProviderInterface = {
        async generate(): Promise<string> { return ''; },
        async generateWithTools(): Promise<string> {
          calls++;
          if (calls === 1) throw new Error('transient failure');
          return `{"name":"task_complete","arguments":{"summary":"recovered"}}`;
        },
      };

      const loop = new AgentLoop({
        provider: flakeyProvider,
        maxSteps: 5,
        settleMs: 0,
        retryOnError: 1,
      });

      const events = await collectWithTimers(loop, 'Retry once');

      expect(calls).toBe(2);
      const complete = events.find((e) => e.type === 'complete');
      expect(complete).toBeDefined();
      expect((complete as { type: 'complete'; result: string }).result).toBe('recovered');
    });

    it('emits error when provider fails more times than retryOnError allows', async () => {
      let calls = 0;
      const alwaysFailsProvider: LLMProviderInterface = {
        async generate(): Promise<string> { return ''; },
        async generateWithTools(): Promise<string> {
          calls++;
          throw new Error(`failure #${calls}`);
        },
      };

      const loop = new AgentLoop({
        provider: alwaysFailsProvider,
        maxSteps: 5,
        settleMs: 0,
        retryOnError: 2,
      });

      const events = await collectWithTimers(loop, 'All retries exhausted');

      expect(calls).toBe(3);
      const error = events.find((e) => e.type === 'error');
      expect(error).toBeDefined();
      expect((error as { type: 'error'; error: Error }).error.message).toBe('failure #3');
    });

    it('does not retry when retryOnError=0 (default)', async () => {
      let calls = 0;
      const failOnceProvider: LLMProviderInterface = {
        async generate(): Promise<string> { return ''; },
        async generateWithTools(): Promise<string> {
          calls++;
          throw new Error('no retry');
        },
      };

      const loop = new AgentLoop({
        provider: failOnceProvider,
        maxSteps: 3,
        settleMs: 0,
        retryOnError: 0,
      });

      const events = await collectWithTimers(loop, 'No retry');

      expect(calls).toBe(1);
      const error = events.find((e) => e.type === 'error');
      expect(error).toBeDefined();
    });
  });

  describe('systemPromptSuffix', () => {
    it('appends suffix text to the prompt passed to the provider', async () => {
      const capturedPrompts: string[] = [];
      const capturingProvider: LLMProviderInterface = {
        async generate(): Promise<string> { return ''; },
        async generateWithTools(prompt: string): Promise<string> {
          capturedPrompts.push(prompt);
          return `{"name":"task_complete","arguments":{"summary":"done"}}`;
        },
      };

      const loop = new AgentLoop({
        provider: capturingProvider,
        maxSteps: 5,
        settleMs: 0,
        systemPromptSuffix: 'Always use nodeId, never coordinates.',
      });

      await collectEvents(loop, 'Test suffix injection');

      expect(capturedPrompts.length).toBeGreaterThan(0);
      expect(capturedPrompts[0]).toContain('Always use nodeId, never coordinates.');
    });

    it('does not add additional instructions section when suffix is empty', async () => {
      const capturedPrompts: string[] = [];
      const capturingProvider: LLMProviderInterface = {
        async generate(): Promise<string> { return ''; },
        async generateWithTools(prompt: string): Promise<string> {
          capturedPrompts.push(prompt);
          return `{"name":"task_complete","arguments":{"summary":"done"}}`;
        },
      };

      const loop = new AgentLoop({
        provider: capturingProvider,
        maxSteps: 5,
        settleMs: 0,
        systemPromptSuffix: '',
      });

      await collectEvents(loop, 'Test no suffix');

      expect(capturedPrompts[0]).not.toContain('Additional instructions');
    });
  });

  describe('tool result tracking', () => {
    it('action event has result=true after a successful tap', async () => {
      mockController.tapNode.mockResolvedValue(true);

      const loop = new AgentLoop({
        provider: makeTapThenCompleteProvider('ok-node'),
        maxSteps: 5,
        settleMs: 0,
      });

      const events = await collectEvents(loop, 'Tap result tracking');

      const action = events.find((e) => e.type === 'action') as
        | Extract<AgentEvent, { type: 'action' }>
        | undefined;
      expect(action).toBeDefined();
      expect(action!.result).toBe(true);
    });

    it('action event has result=false when tapNode returns false', async () => {
      mockController.tapNode.mockResolvedValue(false);

      const loop = new AgentLoop({
        provider: makeTapThenCompleteProvider('fail-node'),
        maxSteps: 5,
        settleMs: 0,
      });

      const events = await collectEvents(loop, 'Tap fails');

      const action = events.find((e) => e.type === 'action') as
        | Extract<AgentEvent, { type: 'action' }>
        | undefined;
      expect(action).toBeDefined();
      expect(action!.result).toBe(false);
    });

    it('action event has result=Error when tool throws', async () => {
      mockController.tapNode.mockRejectedValueOnce(new Error('touch blocked'));

      const loop = new AgentLoop({
        provider: makeTapThenCompleteProvider('blocked-node'),
        maxSteps: 5,
        settleMs: 0,
      });

      const events = await collectEvents(loop, 'Tool throws');

      const action = events.find((e) => e.type === 'action') as
        | Extract<AgentEvent, { type: 'action' }>
        | undefined;
      expect(action).toBeDefined();
      expect(action!.result).toBeInstanceOf(Error);
      expect((action!.result as Error).message).toBe('touch blocked');
    });

    it('includes → ok in the prompt after a successful action', async () => {
      mockController.tapNode.mockResolvedValue(true);

      const capturedPrompts: string[] = [];
      let call = 0;
      const capturingProvider: LLMProviderInterface = {
        async generate(): Promise<string> { return ''; },
        async generateWithTools(prompt: string): Promise<string> {
          capturedPrompts.push(prompt);
          call++;
          if (call === 1) return '{"name":"tap","arguments":{"nodeId":"x"}}';
          return '{"name":"task_complete","arguments":{"summary":"done"}}';
        },
      };

      const loop = new AgentLoop({
        provider: capturingProvider,
        maxSteps: 5,
        settleMs: 0,
      });

      await collectEvents(loop, 'Check prompt annotation');

      // Second prompt should include the action history with → ok
      expect(capturedPrompts.length).toBeGreaterThanOrEqual(2);
      expect(capturedPrompts[1]).toContain('→ ok');
    });

    it('includes → failed in the prompt after a failed action', async () => {
      mockController.tapNode.mockResolvedValue(false);

      const capturedPrompts: string[] = [];
      let call = 0;
      const capturingProvider: LLMProviderInterface = {
        async generate(): Promise<string> { return ''; },
        async generateWithTools(prompt: string): Promise<string> {
          capturedPrompts.push(prompt);
          call++;
          if (call === 1) return '{"name":"tap","arguments":{"nodeId":"x"}}';
          return '{"name":"task_complete","arguments":{"summary":"done"}}';
        },
      };

      const loop = new AgentLoop({
        provider: capturingProvider,
        maxSteps: 5,
        settleMs: 0,
      });

      await collectEvents(loop, 'Check failed annotation');

      expect(capturedPrompts.length).toBeGreaterThanOrEqual(2);
      expect(capturedPrompts[1]).toContain('→ failed');
    });
  });

  describe('thinking extraction', () => {
    it('emits a thinking event when the provider prefixes the tool call with text', async () => {
      let call = 0;
      const thinkingProvider: LLMProviderInterface = {
        async generate(): Promise<string> {
          return '';
        },
        async generateWithTools(): Promise<string> {
          call++;
          if (call === 1) {
            return 'Let me tap the button. {"name":"tap","arguments":{"nodeId":"x"}}';
          }
          return '{"name":"task_complete","arguments":{"summary":"done"}}';
        },
      };

      const loop = new AgentLoop({
        provider: thinkingProvider,
        maxSteps: 5,
        settleMs: 0,
      });

      const events = await collectEvents(loop, 'Think then act');

      const thinking = events.find((e) => e.type === 'thinking');
      expect(thinking).toBeDefined();
      expect(
        (thinking as { type: 'thinking'; content: string }).content,
      ).toContain('Let me tap');
    });
  });
});
