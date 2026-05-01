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
  performAction: jest.fn().mockResolvedValue(true),
  tapNode: jest.fn().mockResolvedValue(true),
  tap: jest.fn().mockResolvedValue(true),
  longPressNode: jest.fn().mockResolvedValue(true),
  longPress: jest.fn().mockResolvedValue(true),
  setNodeText: jest.fn().mockResolvedValue(true),
  swipe: jest.fn().mockResolvedValue(true),
  scrollNode: jest.fn().mockResolvedValue(true),
  openApp: jest.fn().mockResolvedValue(true),
  getInstalledApps: jest.fn().mockResolvedValue([]),
  globalAction: jest.fn().mockResolvedValue(true),
  takeScreenshot: jest.fn().mockResolvedValue('/tmp/screen.png'),
  getScreenText: jest.fn().mockResolvedValue('default screen text'),
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

    it('invokes onMaxSteps callback when the step limit is reached', async () => {
      const onMaxSteps = jest.fn();
      const loop = new AgentLoop({
        provider: makePlainTextProvider(),
        maxSteps: 2,
        settleMs: 0,
        onMaxSteps,
      });

      await collectEvents(loop, 'Trigger max steps');

      expect(onMaxSteps).toHaveBeenCalledTimes(1);
    });

    it('does not invoke onMaxSteps when the task completes normally', async () => {
      const onMaxSteps = jest.fn();
      const loop = new AgentLoop({
        provider: makeCompletingProvider(),
        settleMs: 0,
        onMaxSteps,
      });

      await collectEvents(loop, 'Normal task');

      expect(onMaxSteps).not.toHaveBeenCalled();
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

  describe('maxScreenLength', () => {
    it('truncates the screen state in the prompt when the tree is large', async () => {
      // Build a large tree: 50 non-interactive text nodes
      const bigTree = {
        nodeId: 'root',
        text: null,
        children: Array.from({ length: 50 }, (_, i) => ({
          nodeId: `node-${i}`,
          className: 'android.widget.TextView',
          text: `Static text item number ${i} with some longer content here`,
          children: [],
        })),
      };
      mockController.getAccessibilityTree.mockResolvedValue(bigTree);

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
        maxSteps: 2,
        settleMs: 0,
        maxScreenLength: 200,
      });

      await collectEvents(loop, 'Big screen truncation');

      expect(capturedPrompts.length).toBeGreaterThan(0);
      // With maxScreenLength=200, the screen block should be ≤200 chars
      const screenBlock = capturedPrompts[0]
        .split('\n')
        .filter((l) => l.includes('=== SCREEN STATE ===') || l.includes('node-'))
        .join('\n');
      expect(screenBlock.length).toBeLessThanOrEqual(500); // generous bound after filtering
    });

    it('uses full serialization when maxScreenLength=0', async () => {
      const manyNodeTree = {
        nodeId: 'root',
        text: null,
        children: Array.from({ length: 10 }, (_, i) => ({
          nodeId: `n${i}`,
          className: 'android.widget.TextView',
          text: `Item ${i}`,
          children: [],
        })),
      };
      mockController.getAccessibilityTree.mockResolvedValue(manyNodeTree);

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
        maxSteps: 2,
        settleMs: 0,
        maxScreenLength: 0, // disabled
      });

      await collectEvents(loop, 'Full screen no truncation');

      // All 10 nodes should appear in the prompt
      expect(capturedPrompts[0]).toContain('Item 9');
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

  describe('long_press tool', () => {
    function makeLongPressThenCompleteProvider(nodeId = 'item-1'): LLMProviderInterface {
      let call = 0;
      return {
        async generate(): Promise<string> { return ''; },
        async generateWithTools(): Promise<string> {
          call++;
          if (call === 1) return `{"name":"long_press","arguments":{"nodeId":"${nodeId}"}}`;
          return `{"name":"task_complete","arguments":{"summary":"long press done"}}`;
        },
      };
    }

    it('calls longPressNode with the given nodeId', async () => {
      const loop = new AgentLoop({
        provider: makeLongPressThenCompleteProvider('menu-item'),
        maxSteps: 5,
        settleMs: 0,
      });

      await collectEvents(loop, 'Long press by node');

      expect(mockController.longPressNode).toHaveBeenCalledWith('menu-item');
    });

    it('calls longPress with coordinates when no nodeId is given', async () => {
      const coordProvider: LLMProviderInterface = {
        async generate(): Promise<string> { return ''; },
        async generateWithTools(): Promise<string> {
          if (!mockController.longPress.mock.calls.length) {
            return `{"name":"long_press","arguments":{"x":100,"y":200}}`;
          }
          return `{"name":"task_complete","arguments":{"summary":"done"}}`;
        },
      };

      const loop = new AgentLoop({
        provider: coordProvider,
        maxSteps: 5,
        settleMs: 0,
      });

      await collectEvents(loop, 'Long press by coord');

      expect(mockController.longPress).toHaveBeenCalledWith(100, 200);
    });

    it('emits an action event with tool=long_press', async () => {
      const loop = new AgentLoop({
        provider: makeLongPressThenCompleteProvider('x'),
        maxSteps: 5,
        settleMs: 0,
      });

      const events = await collectEvents(loop, 'Long press action event');

      const action = events.find((e) => e.type === 'action') as
        Extract<AgentEvent, { type: 'action' }> | undefined;
      expect(action?.tool).toBe('long_press');
    });
  });

  describe('onAction / onComplete / onError callbacks', () => {
    it('invokes onAction for each tool call (excluding task_complete)', async () => {
      const onAction = jest.fn();
      const loop = new AgentLoop({
        provider: makeTapThenCompleteProvider('btn'),
        maxSteps: 5,
        settleMs: 0,
        onAction,
      });

      await collectEvents(loop, 'Callback: onAction');

      expect(onAction).toHaveBeenCalledTimes(1);
      expect(onAction).toHaveBeenCalledWith(
        expect.objectContaining({ tool: 'tap', args: { nodeId: 'btn' } }),
      );
      expect(typeof onAction.mock.calls[0][0].timestamp).toBe('number');
    });

    it('invokes onComplete with the summary when task_complete is called', async () => {
      const onComplete = jest.fn();
      const loop = new AgentLoop({
        provider: makeCompletingProvider('mission accomplished'),
        maxSteps: 5,
        settleMs: 0,
        onComplete,
      });

      await collectEvents(loop, 'Callback: onComplete');

      expect(onComplete).toHaveBeenCalledTimes(1);
      expect(onComplete).toHaveBeenCalledWith('mission accomplished');
    });

    it('invokes onError when the LLM provider throws', async () => {
      const onError = jest.fn();
      const loop = new AgentLoop({
        provider: errorProvider,
        maxSteps: 3,
        settleMs: 0,
        onError,
      });

      await collectEvents(loop, 'Callback: onError');

      expect(onError).toHaveBeenCalledTimes(1);
      expect(onError.mock.calls[0][0]).toBeInstanceOf(Error);
      expect(onError.mock.calls[0][0].message).toBe('LLM unavailable');
    });

    it('invokes onError when a tool execution throws', async () => {
      mockController.tapNode.mockRejectedValueOnce(new Error('tap blocked'));
      const onError = jest.fn();
      const loop = new AgentLoop({
        provider: makeTapThenCompleteProvider('blocked'),
        maxSteps: 5,
        settleMs: 0,
        onError,
      });

      await collectEvents(loop, 'Callback: onError from tool');

      expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'tap blocked' }));
    });

    it('invokes onObservation after each screen re-read', async () => {
      const onObservation = jest.fn();
      const loop = new AgentLoop({
        provider: makeTapThenCompleteProvider('btn'),
        maxSteps: 5,
        settleMs: 0,
        onObservation,
      });

      await collectEvents(loop, 'Callback: onObservation');

      expect(onObservation).toHaveBeenCalledTimes(1);
      expect(onObservation).toHaveBeenCalledWith(
        expect.objectContaining({ screenState: expect.any(String), step: 1 }),
      );
    });

    it('invokes onThinking when the model emits text before a tool call', async () => {
      const onThinking = jest.fn();
      // Provider whose first response has thinking text before the JSON tool call.
      let call = 0;
      const thinkingProvider: LLMProviderInterface = {
        async generate(): Promise<string> { return ''; },
        async generateWithTools(): Promise<string> {
          call++;
          if (call === 1) {
            return 'I should tap the button.\n{"name":"tap","arguments":{"nodeId":"btn"}}';
          }
          return '{"name":"task_complete","arguments":{"summary":"done"}}';
        },
      };

      const loop = new AgentLoop({ provider: thinkingProvider, maxSteps: 5, settleMs: 0, onThinking });
      await collectEvents(loop, 'Callback: onThinking');

      expect(onThinking).toHaveBeenCalledTimes(1);
      expect(onThinking).toHaveBeenCalledWith('I should tap the button.');
    });
  });

  describe('task_failed', () => {
    it('emits a failed event with the reason and exits the loop', async () => {
      const failingProvider: LLMProviderInterface = {
        async generate(): Promise<string> { return ''; },
        async generateWithTools(): Promise<string> {
          return '{"name":"task_failed","arguments":{"reason":"Element not found on screen"}}';
        },
      };

      const loop = new AgentLoop({ provider: failingProvider, maxSteps: 5, settleMs: 0 });
      const events = await collectEvents(loop, 'tap missing button');

      const failedEvent = events.find((e) => e.type === 'failed') as
        Extract<AgentEvent, { type: 'failed' }> | undefined;
      expect(failedEvent).toBeDefined();
      expect(failedEvent!.reason).toBe('Element not found on screen');
    });

    it('does not emit max_steps_reached when task_failed is called', async () => {
      const failingProvider: LLMProviderInterface = {
        async generate(): Promise<string> { return ''; },
        async generateWithTools(): Promise<string> {
          return '{"name":"task_failed","arguments":{"reason":"blocked"}}';
        },
      };

      const loop = new AgentLoop({ provider: failingProvider, maxSteps: 5, settleMs: 0 });
      const events = await collectEvents(loop, 'impossible task');

      expect(events.some((e) => e.type === 'max_steps_reached')).toBe(false);
    });

    it('invokes onFailed callback with the reason', async () => {
      const onFailed = jest.fn();
      const failingProvider: LLMProviderInterface = {
        async generate(): Promise<string> { return ''; },
        async generateWithTools(): Promise<string> {
          return '{"name":"task_failed","arguments":{"reason":"cannot proceed"}}';
        },
      };

      const loop = new AgentLoop({ provider: failingProvider, maxSteps: 5, settleMs: 0, onFailed });
      await collectEvents(loop, 'test onFailed callback');

      expect(onFailed).toHaveBeenCalledTimes(1);
      expect(onFailed).toHaveBeenCalledWith('cannot proceed');
    });
  });

  describe('find_node tool', () => {
    it('returns the nodeId of a matching node via text search', async () => {
      mockController.getAccessibilityTree.mockResolvedValue([
        {
          nodeId: 'root',
          text: null,
          contentDescription: null,
          className: 'FrameLayout',
          children: [
            { nodeId: 'btn-settings', text: 'Settings', contentDescription: null, className: 'TextView', children: [] },
          ],
        },
      ]);

      let findResult: unknown;
      let call = 0;
      const capturingProvider: LLMProviderInterface = {
        async generate(): Promise<string> { return ''; },
        async generateWithTools(): Promise<string> {
          call++;
          if (call === 1) return '{"name":"find_node","arguments":{"text":"Settings"}}';
          return '{"name":"task_complete","arguments":{"summary":"found"}}';
        },
      };

      const loop = new AgentLoop({ provider: capturingProvider, maxSteps: 5, settleMs: 0 });
      const events = await collectEvents(loop, 'find Settings node');

      const action = events.find(
        (e) => e.type === 'action' && (e as Extract<AgentEvent, { type: 'action' }>).tool === 'find_node',
      ) as Extract<AgentEvent, { type: 'action' }> | undefined;
      expect(action).toBeDefined();
      findResult = action!.result;
      expect(findResult).toBe('btn-settings');
    });

    it('returns null when no node matches the query', async () => {
      mockController.getAccessibilityTree.mockResolvedValue([
        { nodeId: 'root', text: 'Home', contentDescription: null, className: 'FrameLayout', children: [] },
      ]);

      let call = 0;
      const provider: LLMProviderInterface = {
        async generate(): Promise<string> { return ''; },
        async generateWithTools(): Promise<string> {
          call++;
          if (call === 1) return '{"name":"find_node","arguments":{"text":"NonExistent"}}';
          return '{"name":"task_complete","arguments":{"summary":"done"}}';
        },
      };

      const loop = new AgentLoop({ provider, maxSteps: 5, settleMs: 0 });
      const events = await collectEvents(loop, 'find missing node');

      const action = events.find(
        (e) => e.type === 'action' && (e as Extract<AgentEvent, { type: 'action' }>).tool === 'find_node',
      ) as Extract<AgentEvent, { type: 'action' }> | undefined;
      expect(action).toBeDefined();
      expect(action!.result).toBeNull();
    });

    it('filters by isChecked=true and returns only checked node', async () => {
      mockController.getAccessibilityTree.mockResolvedValue([
        { nodeId: 'chk-off', text: 'Wi-Fi', contentDescription: null, className: 'CheckBox', isChecked: false, children: [] },
        { nodeId: 'chk-on', text: 'Wi-Fi', contentDescription: null, className: 'CheckBox', isChecked: true, children: [] },
      ]);

      let call = 0;
      const provider: LLMProviderInterface = {
        async generate(): Promise<string> { return ''; },
        async generateWithTools(): Promise<string> {
          call++;
          if (call === 1) return '{"name":"find_node","arguments":{"text":"Wi-Fi","isChecked":true}}';
          return '{"name":"task_complete","arguments":{"summary":"done"}}';
        },
      };

      const loop = new AgentLoop({ provider, maxSteps: 5, settleMs: 0 });
      const events = await collectEvents(loop, 'find checked Wi-Fi toggle');

      const action = events.find(
        (e) => e.type === 'action' && (e as Extract<AgentEvent, { type: 'action' }>).tool === 'find_node',
      ) as Extract<AgentEvent, { type: 'action' }> | undefined;
      expect(action).toBeDefined();
      expect(action!.result).toBe('chk-on');
    });

    it('filters by isEnabled=false and returns disabled node', async () => {
      mockController.getAccessibilityTree.mockResolvedValue([
        { nodeId: 'btn-enabled', text: 'Submit', contentDescription: null, className: 'Button', isEnabled: true, children: [] },
        { nodeId: 'btn-disabled', text: 'Submit', contentDescription: null, className: 'Button', isEnabled: false, children: [] },
      ]);

      let call = 0;
      const provider: LLMProviderInterface = {
        async generate(): Promise<string> { return ''; },
        async generateWithTools(): Promise<string> {
          call++;
          if (call === 1) return '{"name":"find_node","arguments":{"text":"Submit","isEnabled":false}}';
          return '{"name":"task_complete","arguments":{"summary":"done"}}';
        },
      };

      const loop = new AgentLoop({ provider, maxSteps: 5, settleMs: 0 });
      const events = await collectEvents(loop, 'find disabled submit button');

      const action = events.find(
        (e) => e.type === 'action' && (e as Extract<AgentEvent, { type: 'action' }>).tool === 'find_node',
      ) as Extract<AgentEvent, { type: 'action' }> | undefined;
      expect(action).toBeDefined();
      expect(action!.result).toBe('btn-disabled');
    });
  });

  describe('find_all_nodes tool', () => {
    it('returns all matching nodeIds from a flat tree', async () => {
      mockController.getAccessibilityTree.mockResolvedValue([
        { nodeId: 'btn1', text: 'Settings', contentDescription: null, className: 'Button', children: [] },
        { nodeId: 'view1', text: 'Home', contentDescription: null, className: 'View', children: [] },
        { nodeId: 'btn2', text: 'Advanced Settings', contentDescription: null, className: 'Button', children: [] },
      ]);

      let call = 0;
      const provider: LLMProviderInterface = {
        async generate(): Promise<string> { return ''; },
        async generateWithTools(): Promise<string> {
          call++;
          if (call === 1) return '{"name":"find_all_nodes","arguments":{"text":"Settings"}}';
          return '{"name":"task_complete","arguments":{"summary":"done"}}';
        },
      };

      const loop = new AgentLoop({ provider, maxSteps: 5, settleMs: 0 });
      const events = await collectEvents(loop, 'find all Settings nodes');

      const action = events.find(
        (e) => e.type === 'action' && (e as Extract<AgentEvent, { type: 'action' }>).tool === 'find_all_nodes',
      ) as Extract<AgentEvent, { type: 'action' }> | undefined;
      expect(action).toBeDefined();
      expect(action!.result).toEqual(['btn1', 'btn2']);
    });

    it('returns an empty array when no nodes match', async () => {
      mockController.getAccessibilityTree.mockResolvedValue([
        { nodeId: 'root', text: 'Home', contentDescription: null, className: 'FrameLayout', children: [] },
      ]);

      let call = 0;
      const provider: LLMProviderInterface = {
        async generate(): Promise<string> { return ''; },
        async generateWithTools(): Promise<string> {
          call++;
          if (call === 1) return '{"name":"find_all_nodes","arguments":{"text":"Settings"}}';
          return '{"name":"task_complete","arguments":{"summary":"done"}}';
        },
      };

      const loop = new AgentLoop({ provider, maxSteps: 5, settleMs: 0 });
      const events = await collectEvents(loop, 'find all nodes no match');

      const action = events.find(
        (e) => e.type === 'action' && (e as Extract<AgentEvent, { type: 'action' }>).tool === 'find_all_nodes',
      ) as Extract<AgentEvent, { type: 'action' }> | undefined;
      expect(action).toBeDefined();
      expect(action!.result).toEqual([]);
    });

    it('collects matching nodes across a nested tree', async () => {
      mockController.getAccessibilityTree.mockResolvedValue([
        {
          nodeId: 'container',
          text: null,
          contentDescription: null,
          className: 'View',
          children: [
            { nodeId: 'child1', text: null, contentDescription: null, className: 'android.widget.Button', children: [] },
            { nodeId: 'child2', text: null, contentDescription: null, className: 'android.widget.Button', children: [] },
          ],
        },
      ]);

      let call = 0;
      const provider: LLMProviderInterface = {
        async generate(): Promise<string> { return ''; },
        async generateWithTools(): Promise<string> {
          call++;
          if (call === 1) return '{"name":"find_all_nodes","arguments":{"className":"android.widget.Button"}}';
          return '{"name":"task_complete","arguments":{"summary":"done"}}';
        },
      };

      const loop = new AgentLoop({ provider, maxSteps: 5, settleMs: 0 });
      const events = await collectEvents(loop, 'find all buttons');

      const action = events.find(
        (e) => e.type === 'action' && (e as Extract<AgentEvent, { type: 'action' }>).tool === 'find_all_nodes',
      ) as Extract<AgentEvent, { type: 'action' }> | undefined;
      expect(action).toBeDefined();
      expect(action!.result).toEqual(['child1', 'child2']);
    });

    it('collects only unchecked checkboxes using isChecked=false', async () => {
      mockController.getAccessibilityTree.mockResolvedValue([
        { nodeId: 'opt1', text: 'Option A', contentDescription: null, className: 'CheckBox', isChecked: false, children: [] },
        { nodeId: 'opt2', text: 'Option B', contentDescription: null, className: 'CheckBox', isChecked: true, children: [] },
        { nodeId: 'opt3', text: 'Option C', contentDescription: null, className: 'CheckBox', isChecked: false, children: [] },
      ]);

      let call = 0;
      const provider: LLMProviderInterface = {
        async generate(): Promise<string> { return ''; },
        async generateWithTools(): Promise<string> {
          call++;
          if (call === 1) return '{"name":"find_all_nodes","arguments":{"className":"CheckBox","isChecked":false}}';
          return '{"name":"task_complete","arguments":{"summary":"done"}}';
        },
      };

      const loop = new AgentLoop({ provider, maxSteps: 5, settleMs: 0 });
      const events = await collectEvents(loop, 'find all unchecked options');

      const action = events.find(
        (e) => e.type === 'action' && (e as Extract<AgentEvent, { type: 'action' }>).tool === 'find_all_nodes',
      ) as Extract<AgentEvent, { type: 'action' }> | undefined;
      expect(action).toBeDefined();
      expect(action!.result).toEqual(['opt1', 'opt3']);
    });
  });

  describe('wait_for_node tool', () => {
    it('returns nodeId when node is present on first poll', async () => {
      mockController.getAccessibilityTree.mockResolvedValue([
        {
          nodeId: 'root',
          text: null,
          contentDescription: null,
          className: 'FrameLayout',
          children: [
            { nodeId: 'loaded-btn', text: 'Submit', contentDescription: null, className: 'Button', children: [] },
          ],
        },
      ]);

      let call = 0;
      const provider: LLMProviderInterface = {
        async generate(): Promise<string> { return ''; },
        async generateWithTools(): Promise<string> {
          call++;
          if (call === 1) return '{"name":"wait_for_node","arguments":{"text":"Submit","timeoutMs":5000,"intervalMs":0}}';
          return '{"name":"task_complete","arguments":{"summary":"found"}}';
        },
      };

      const loop = new AgentLoop({ provider, maxSteps: 5, settleMs: 0 });
      const events = await collectEvents(loop, 'wait for submit button');

      const action = events.find(
        (e) => e.type === 'action' && (e as Extract<AgentEvent, { type: 'action' }>).tool === 'wait_for_node',
      ) as Extract<AgentEvent, { type: 'action' }> | undefined;
      expect(action).toBeDefined();
      expect(action!.result).toBe('loaded-btn');
    });

    it('returns null when timeout expires before node appears', async () => {
      mockController.getAccessibilityTree.mockResolvedValue([
        { nodeId: 'root', text: null, contentDescription: null, className: 'FrameLayout', children: [] },
      ]);

      let call = 0;
      const provider: LLMProviderInterface = {
        async generate(): Promise<string> { return ''; },
        async generateWithTools(): Promise<string> {
          call++;
          if (call === 1) return '{"name":"wait_for_node","arguments":{"text":"Missing","timeoutMs":0}}';
          return '{"name":"task_complete","arguments":{"summary":"done"}}';
        },
      };

      const loop = new AgentLoop({ provider, maxSteps: 5, settleMs: 0 });
      const events = await collectEvents(loop, 'wait for missing node');

      const action = events.find(
        (e) => e.type === 'action' && (e as Extract<AgentEvent, { type: 'action' }>).tool === 'wait_for_node',
      ) as Extract<AgentEvent, { type: 'action' }> | undefined;
      expect(action).toBeDefined();
      expect(action!.result).toBeNull();
    });

    it('polls until node appears on a later iteration', async () => {
      let treeCalls = 0;
      mockController.getAccessibilityTree.mockImplementation(async () => {
        treeCalls++;
        if (treeCalls < 3) {
          return [{ nodeId: 'root', text: null, contentDescription: null, className: 'View', children: [] }];
        }
        return [
          {
            nodeId: 'root',
            text: null,
            contentDescription: null,
            className: 'View',
            children: [
              { nodeId: 'dynamic-node', text: 'Loaded', contentDescription: null, className: 'TextView', children: [] },
            ],
          },
        ];
      });

      let call = 0;
      const provider: LLMProviderInterface = {
        async generate(): Promise<string> { return ''; },
        async generateWithTools(): Promise<string> {
          call++;
          if (call === 1) return '{"name":"wait_for_node","arguments":{"text":"Loaded","timeoutMs":10000,"intervalMs":0}}';
          return '{"name":"task_complete","arguments":{"summary":"done"}}';
        },
      };

      const loop = new AgentLoop({ provider, maxSteps: 5, settleMs: 0 });
      const events = await collectEvents(loop, 'wait for dynamic node');

      const action = events.find(
        (e) => e.type === 'action' && (e as Extract<AgentEvent, { type: 'action' }>).tool === 'wait_for_node',
      ) as Extract<AgentEvent, { type: 'action' }> | undefined;
      expect(action).toBeDefined();
      expect(action!.result).toBe('dynamic-node');
      expect(treeCalls).toBeGreaterThanOrEqual(3);
    });
  });

  describe('wait_for_change tool', () => {
    it('returns true when screen text changes before timeout', async () => {
      let textCall = 0;
      mockController.getScreenText.mockImplementation(async () => {
        textCall++;
        return textCall === 1 ? 'before screen' : 'after screen';
      });

      let call = 0;
      const provider: LLMProviderInterface = {
        async generate(): Promise<string> { return ''; },
        async generateWithTools(): Promise<string> {
          call++;
          if (call === 1) return '{"name":"wait_for_change","arguments":{"timeoutMs":10000,"pollIntervalMs":0}}';
          return '{"name":"task_complete","arguments":{"summary":"done"}}';
        },
      };

      const loop = new AgentLoop({ provider, maxSteps: 5, settleMs: 0 });
      const events = await collectEvents(loop, 'wait for screen change');

      const action = events.find(
        (e) => e.type === 'action' && (e as Extract<AgentEvent, { type: 'action' }>).tool === 'wait_for_change',
      ) as Extract<AgentEvent, { type: 'action' }> | undefined;
      expect(action).toBeDefined();
      expect(action!.result).toBe(true);
    });

    it('returns false when screen does not change within timeout', async () => {
      mockController.getScreenText.mockResolvedValue('static screen');

      let call = 0;
      const provider: LLMProviderInterface = {
        async generate(): Promise<string> { return ''; },
        async generateWithTools(): Promise<string> {
          call++;
          if (call === 1) return '{"name":"wait_for_change","arguments":{"timeoutMs":0}}';
          return '{"name":"task_complete","arguments":{"summary":"done"}}';
        },
      };

      const loop = new AgentLoop({ provider, maxSteps: 5, settleMs: 0 });
      const events = await collectEvents(loop, 'wait for change that never comes');

      const action = events.find(
        (e) => e.type === 'action' && (e as Extract<AgentEvent, { type: 'action' }>).tool === 'wait_for_change',
      ) as Extract<AgentEvent, { type: 'action' }> | undefined;
      expect(action).toBeDefined();
      expect(action!.result).toBe(false);
    });

    it('polls multiple times until screen changes', async () => {
      let textCalls = 0;
      mockController.getScreenText.mockImplementation(async () => {
        textCalls++;
        return textCalls < 4 ? 'initial screen' : 'new screen';
      });

      let call = 0;
      const provider: LLMProviderInterface = {
        async generate(): Promise<string> { return ''; },
        async generateWithTools(): Promise<string> {
          call++;
          if (call === 1) return '{"name":"wait_for_change","arguments":{"timeoutMs":10000,"pollIntervalMs":0}}';
          return '{"name":"task_complete","arguments":{"summary":"done"}}';
        },
      };

      const loop = new AgentLoop({ provider, maxSteps: 5, settleMs: 0 });
      const events = await collectEvents(loop, 'wait for delayed change');

      const action = events.find(
        (e) => e.type === 'action' && (e as Extract<AgentEvent, { type: 'action' }>).tool === 'wait_for_change',
      ) as Extract<AgentEvent, { type: 'action' }> | undefined;
      expect(action).toBeDefined();
      expect(action!.result).toBe(true);
      // baseline (call 1) + at least 3 polls before change on call 4
      expect(textCalls).toBeGreaterThanOrEqual(4);
    });
  });

  describe('get_node_text tool', () => {
    it('returns text and contentDescription of a node by ID', async () => {
      mockController.getAccessibilityTree.mockResolvedValue([
        {
          nodeId: 'root',
          text: null,
          contentDescription: null,
          className: 'FrameLayout',
          children: [
            {
              nodeId: 'label-42',
              text: 'Hello World',
              contentDescription: 'Greeting label',
              className: 'TextView',
              children: [],
            },
          ],
        },
      ]);

      let call = 0;
      const provider: LLMProviderInterface = {
        async generate(): Promise<string> { return ''; },
        async generateWithTools(): Promise<string> {
          call++;
          if (call === 1) return '{"name":"get_node_text","arguments":{"nodeId":"label-42"}}';
          return '{"name":"task_complete","arguments":{"summary":"read label"}}';
        },
      };

      const loop = new AgentLoop({ provider, maxSteps: 5, settleMs: 0 });
      const events = await collectEvents(loop, 'read label text');

      const action = events.find(
        (e) => e.type === 'action' && (e as Extract<AgentEvent, { type: 'action' }>).tool === 'get_node_text',
      ) as Extract<AgentEvent, { type: 'action' }> | undefined;
      expect(action).toBeDefined();
      expect(action!.result).toEqual({ text: 'Hello World', contentDescription: 'Greeting label' });
    });

    it('returns null when the nodeId does not exist in the tree', async () => {
      mockController.getAccessibilityTree.mockResolvedValue([
        { nodeId: 'root', text: 'Home', contentDescription: null, className: 'FrameLayout', children: [] },
      ]);

      let call = 0;
      const provider: LLMProviderInterface = {
        async generate(): Promise<string> { return ''; },
        async generateWithTools(): Promise<string> {
          call++;
          if (call === 1) return '{"name":"get_node_text","arguments":{"nodeId":"nonexistent-99"}}';
          return '{"name":"task_complete","arguments":{"summary":"done"}}';
        },
      };

      const loop = new AgentLoop({ provider, maxSteps: 5, settleMs: 0 });
      const events = await collectEvents(loop, 'get text of missing node');

      const action = events.find(
        (e) => e.type === 'action' && (e as Extract<AgentEvent, { type: 'action' }>).tool === 'get_node_text',
      ) as Extract<AgentEvent, { type: 'action' }> | undefined;
      expect(action).toBeDefined();
      expect(action!.result).toBeNull();
    });
  });

  describe('list_apps tool', () => {
    const installedApps = [
      { packageName: 'com.android.settings', label: 'Settings' },
      { packageName: 'com.google.android.apps.maps', label: 'Maps' },
    ];

    beforeEach(() => {
      mockController.getInstalledApps.mockClear();
      mockController.getInstalledApps.mockResolvedValue(installedApps);
    });

    it('calls getInstalledApps() and returns the result', async () => {
      let call = 0;
      const provider: LLMProviderInterface = {
        async generate(): Promise<string> { return ''; },
        async generateWithTools(): Promise<string> {
          call++;
          if (call === 1) return '{"name":"list_apps","arguments":{}}';
          return '{"name":"task_complete","arguments":{"summary":"listed apps"}}';
        },
      };

      const loop = new AgentLoop({ provider, maxSteps: 5, settleMs: 0 });
      const events = await collectEvents(loop, 'list all apps');

      const action = events.find(
        (e) => e.type === 'action' && (e as Extract<AgentEvent, { type: 'action' }>).tool === 'list_apps',
      ) as Extract<AgentEvent, { type: 'action' }> | undefined;
      expect(action).toBeDefined();
      expect(action!.result).toEqual(installedApps);
      expect(mockController.getInstalledApps).toHaveBeenCalledTimes(1);
    });
  });

  describe('set_checked tool', () => {
    const treeWithCheckbox = (isChecked: boolean) => [
      {
        nodeId: 'root',
        text: null,
        contentDescription: null,
        className: 'FrameLayout',
        isChecked: false,
        children: [
          {
            nodeId: 'toggle-1',
            text: 'Wi-Fi',
            contentDescription: null,
            className: 'android.widget.Switch',
            isChecked,
            children: [],
          },
        ],
      },
    ];

    beforeEach(() => {
      mockController.tapNode.mockClear();
    });

    it('taps the node when current state differs from desired', async () => {
      mockController.getAccessibilityTree.mockResolvedValue(treeWithCheckbox(false));

      let call = 0;
      const provider: LLMProviderInterface = {
        async generate(): Promise<string> { return ''; },
        async generateWithTools(): Promise<string> {
          call++;
          if (call === 1) return '{"name":"set_checked","arguments":{"nodeId":"toggle-1","checked":true}}';
          return '{"name":"task_complete","arguments":{"summary":"enabled"}}';
        },
      };

      const loop = new AgentLoop({ provider, maxSteps: 5, settleMs: 0 });
      const events = await collectEvents(loop, 'enable Wi-Fi toggle');

      const action = events.find(
        (e) => e.type === 'action' && (e as Extract<AgentEvent, { type: 'action' }>).tool === 'set_checked',
      ) as Extract<AgentEvent, { type: 'action' }> | undefined;
      expect(action).toBeDefined();
      expect(mockController.tapNode).toHaveBeenCalledWith('toggle-1');
    });

    it('does not tap when node is already in the desired state', async () => {
      mockController.getAccessibilityTree.mockResolvedValue(treeWithCheckbox(true));

      let call = 0;
      const provider: LLMProviderInterface = {
        async generate(): Promise<string> { return ''; },
        async generateWithTools(): Promise<string> {
          call++;
          if (call === 1) return '{"name":"set_checked","arguments":{"nodeId":"toggle-1","checked":true}}';
          return '{"name":"task_complete","arguments":{"summary":"already on"}}';
        },
      };

      const loop = new AgentLoop({ provider, maxSteps: 5, settleMs: 0 });
      const events = await collectEvents(loop, 'enable Wi-Fi toggle (already on)');

      const action = events.find(
        (e) => e.type === 'action' && (e as Extract<AgentEvent, { type: 'action' }>).tool === 'set_checked',
      ) as Extract<AgentEvent, { type: 'action' }> | undefined;
      expect(action).toBeDefined();
      expect(action!.result).toBe(true);
      expect(mockController.tapNode).not.toHaveBeenCalled();
    });

    it('returns false when nodeId is not found in tree', async () => {
      mockController.getAccessibilityTree.mockResolvedValue([
        { nodeId: 'root', text: null, contentDescription: null, className: 'FrameLayout', isChecked: false, children: [] },
      ]);

      let call = 0;
      const provider: LLMProviderInterface = {
        async generate(): Promise<string> { return ''; },
        async generateWithTools(): Promise<string> {
          call++;
          if (call === 1) return '{"name":"set_checked","arguments":{"nodeId":"nonexistent","checked":true}}';
          return '{"name":"task_complete","arguments":{"summary":"done"}}';
        },
      };

      const loop = new AgentLoop({ provider, maxSteps: 5, settleMs: 0 });
      const events = await collectEvents(loop, 'toggle missing node');

      const action = events.find(
        (e) => e.type === 'action' && (e as Extract<AgentEvent, { type: 'action' }>).tool === 'set_checked',
      ) as Extract<AgentEvent, { type: 'action' }> | undefined;
      expect(action).toBeDefined();
      expect(action!.result).toBe(false);
      expect(mockController.tapNode).not.toHaveBeenCalled();
    });
  });

  describe('get_bounds tool', () => {
    const treeWithBounds = [
      {
        nodeId: 'root',
        text: null,
        contentDescription: null,
        className: 'FrameLayout',
        children: [
          {
            nodeId: 'btn-42',
            text: 'OK',
            contentDescription: null,
            className: 'android.widget.Button',
            bounds: { left: 100, top: 200, right: 300, bottom: 250 },
            children: [],
          },
        ],
      },
    ];

    it('returns bounds object for an existing node', async () => {
      mockController.getAccessibilityTree.mockResolvedValue(treeWithBounds);

      let call = 0;
      const provider: LLMProviderInterface = {
        async generate(): Promise<string> { return ''; },
        async generateWithTools(): Promise<string> {
          call++;
          if (call === 1) return '{"name":"get_bounds","arguments":{"nodeId":"btn-42"}}';
          return '{"name":"task_complete","arguments":{"summary":"got bounds"}}';
        },
      };

      const loop = new AgentLoop({ provider, maxSteps: 5, settleMs: 0 });
      const events = await collectEvents(loop, 'get button bounds');

      const action = events.find(
        (e) => e.type === 'action' && (e as Extract<AgentEvent, { type: 'action' }>).tool === 'get_bounds',
      ) as Extract<AgentEvent, { type: 'action' }> | undefined;
      expect(action).toBeDefined();
      expect(action!.result).toEqual({ left: 100, top: 200, right: 300, bottom: 250 });
    });

    it('returns null when the nodeId does not exist in the tree', async () => {
      mockController.getAccessibilityTree.mockResolvedValue([
        { nodeId: 'root', text: null, contentDescription: null, className: 'FrameLayout', children: [] },
      ]);

      let call = 0;
      const provider: LLMProviderInterface = {
        async generate(): Promise<string> { return ''; },
        async generateWithTools(): Promise<string> {
          call++;
          if (call === 1) return '{"name":"get_bounds","arguments":{"nodeId":"nonexistent-99"}}';
          return '{"name":"task_complete","arguments":{"summary":"done"}}';
        },
      };

      const loop = new AgentLoop({ provider, maxSteps: 5, settleMs: 0 });
      const events = await collectEvents(loop, 'get bounds of missing node');

      const action = events.find(
        (e) => e.type === 'action' && (e as Extract<AgentEvent, { type: 'action' }>).tool === 'get_bounds',
      ) as Extract<AgentEvent, { type: 'action' }> | undefined;
      expect(action).toBeDefined();
      expect(action!.result).toBeNull();
    });

    it('returns null when the node has no bounds property', async () => {
      mockController.getAccessibilityTree.mockResolvedValue([
        {
          nodeId: 'no-bounds',
          text: 'Boundless',
          contentDescription: null,
          className: 'View',
          children: [],
        },
      ]);

      let call = 0;
      const provider: LLMProviderInterface = {
        async generate(): Promise<string> { return ''; },
        async generateWithTools(): Promise<string> {
          call++;
          if (call === 1) return '{"name":"get_bounds","arguments":{"nodeId":"no-bounds"}}';
          return '{"name":"task_complete","arguments":{"summary":"done"}}';
        },
      };

      const loop = new AgentLoop({ provider, maxSteps: 5, settleMs: 0 });
      const events = await collectEvents(loop, 'get bounds of node without bounds');

      const action = events.find(
        (e) => e.type === 'action' && (e as Extract<AgentEvent, { type: 'action' }>).tool === 'get_bounds',
      ) as Extract<AgentEvent, { type: 'action' }> | undefined;
      expect(action).toBeDefined();
      expect(action!.result).toBeNull();
    });
  });

  describe('write_note and read_note tools', () => {
    it('write_note stores a value and read_note retrieves it within the same task', async () => {
      let call = 0;
      const provider: LLMProviderInterface = {
        async generate(): Promise<string> { return ''; },
        async generateWithTools(): Promise<string> {
          call++;
          if (call === 1) return '{"name":"write_note","arguments":{"key":"pkg","value":"com.example.app"}}';
          if (call === 2) return '{"name":"read_note","arguments":{"key":"pkg"}}';
          return '{"name":"task_complete","arguments":{"summary":"noted"}}';
        },
      };

      const loop = new AgentLoop({ provider, maxSteps: 10, settleMs: 0 });
      const events = await collectEvents(loop, 'remember the package name');

      const writeAction = events.find(
        (e) => e.type === 'action' && (e as Extract<AgentEvent, { type: 'action' }>).tool === 'write_note',
      ) as Extract<AgentEvent, { type: 'action' }> | undefined;
      expect(writeAction).toBeDefined();
      expect(writeAction!.result).toBe(true);

      const readAction = events.find(
        (e) => e.type === 'action' && (e as Extract<AgentEvent, { type: 'action' }>).tool === 'read_note',
      ) as Extract<AgentEvent, { type: 'action' }> | undefined;
      expect(readAction).toBeDefined();
      expect(readAction!.result).toBe('com.example.app');
    });

    it('read_note returns null for a key that was never written', async () => {
      let call = 0;
      const provider: LLMProviderInterface = {
        async generate(): Promise<string> { return ''; },
        async generateWithTools(): Promise<string> {
          call++;
          if (call === 1) return '{"name":"read_note","arguments":{"key":"nonexistent"}}';
          return '{"name":"task_complete","arguments":{"summary":"done"}}';
        },
      };

      const loop = new AgentLoop({ provider, maxSteps: 5, settleMs: 0 });
      const events = await collectEvents(loop, 'read missing note');

      const readAction = events.find(
        (e) => e.type === 'action' && (e as Extract<AgentEvent, { type: 'action' }>).tool === 'read_note',
      ) as Extract<AgentEvent, { type: 'action' }> | undefined;
      expect(readAction).toBeDefined();
      expect(readAction!.result).toBeNull();
    });

    it('notes are cleared between run() calls', async () => {
      let writeCall = 0;
      const writeProvider: LLMProviderInterface = {
        async generate(): Promise<string> { return ''; },
        async generateWithTools(): Promise<string> {
          writeCall++;
          if (writeCall === 1) return '{"name":"write_note","arguments":{"key":"x","value":"first-run"}}';
          return '{"name":"task_complete","arguments":{"summary":"done"}}';
        },
      };

      const loop = new AgentLoop({ provider: writeProvider, maxSteps: 5, settleMs: 0 });
      // First run writes the note
      await collectEvents(loop, 'task 1');

      // Second run with a provider that reads the same key
      let readCall = 0;
      const readProvider: LLMProviderInterface = {
        async generate(): Promise<string> { return ''; },
        async generateWithTools(): Promise<string> {
          readCall++;
          if (readCall === 1) return '{"name":"read_note","arguments":{"key":"x"}}';
          return '{"name":"task_complete","arguments":{"summary":"done"}}';
        },
      };
      (loop as unknown as { options: { provider: LLMProviderInterface } }).options.provider = readProvider;

      const events2 = await collectEvents(loop, 'task 2');
      const readAction = events2.find(
        (e) => e.type === 'action' && (e as Extract<AgentEvent, { type: 'action' }>).tool === 'read_note',
      ) as Extract<AgentEvent, { type: 'action' }> | undefined;
      expect(readAction).toBeDefined();
      // Note should be gone — cleared at the start of the new run
      expect(readAction!.result).toBeNull();
    });
  });

  describe('type_text tool', () => {
    it('calls setNodeText with the provided nodeId when given', async () => {
      let call = 0;
      const provider: LLMProviderInterface = {
        async generate(): Promise<string> { return ''; },
        async generateWithTools(): Promise<string> {
          call++;
          if (call === 1) return '{"name":"type_text","arguments":{"text":"hello","nodeId":"input-1"}}';
          return '{"name":"task_complete","arguments":{"summary":"typed"}}';
        },
      };

      const loop = new AgentLoop({ provider, maxSteps: 5, settleMs: 0 });
      await collectEvents(loop, 'type hello');

      expect(mockController.setNodeText).toHaveBeenCalledWith('input-1', 'hello');
    });

    it('auto-detects focused editable node when nodeId is omitted', async () => {
      mockController.getAccessibilityTree.mockResolvedValue({
        nodeId: 'root',
        className: 'FrameLayout',
        children: [
          {
            nodeId: 'search-box',
            className: 'EditText',
            text: '',
            isFocused: true,
            isEditable: true,
            children: [],
          },
        ],
      });

      let call = 0;
      const provider: LLMProviderInterface = {
        async generate(): Promise<string> { return ''; },
        async generateWithTools(): Promise<string> {
          call++;
          if (call === 1) return '{"name":"type_text","arguments":{"text":"search query"}}';
          return '{"name":"task_complete","arguments":{"summary":"typed"}}';
        },
      };

      const loop = new AgentLoop({ provider, maxSteps: 5, settleMs: 0 });
      await collectEvents(loop, 'search for something');

      expect(mockController.setNodeText).toHaveBeenCalledWith('search-box', 'search query');
    });

    it('emits error when no focused editable node and no nodeId given', async () => {
      // Default tree has no editable/focused node
      let call = 0;
      const provider: LLMProviderInterface = {
        async generate(): Promise<string> { return ''; },
        async generateWithTools(): Promise<string> {
          call++;
          if (call === 1) return '{"name":"type_text","arguments":{"text":"oops"}}';
          return '{"name":"task_complete","arguments":{"summary":"done"}}';
        },
      };

      const loop = new AgentLoop({ provider, maxSteps: 5, settleMs: 0 });
      const events = await collectEvents(loop, 'type without focus');

      const errorEvent = events.find((e) => e.type === 'error');
      expect(errorEvent).toBeDefined();
    });
  });

  describe('clear_text tool', () => {
    it('calls performAction with clearText on the provided nodeId', async () => {
      let call = 0;
      const provider: LLMProviderInterface = {
        async generate(): Promise<string> { return ''; },
        async generateWithTools(): Promise<string> {
          call++;
          if (call === 1) return '{"name":"clear_text","arguments":{"nodeId":"input-42"}}';
          return '{"name":"task_complete","arguments":{"summary":"cleared"}}';
        },
      };

      const loop = new AgentLoop({ provider, maxSteps: 5, settleMs: 0 });
      await collectEvents(loop, 'clear the search box');

      expect(mockController.performAction).toHaveBeenCalledWith('input-42', 'clearText');
    });

    it('auto-detects focused editable node when nodeId is omitted', async () => {
      mockController.getAccessibilityTree.mockResolvedValue({
        nodeId: 'root',
        className: 'FrameLayout',
        children: [
          {
            nodeId: 'search-field',
            className: 'EditText',
            text: 'old content',
            isFocused: true,
            isEditable: true,
            children: [],
          },
        ],
      });

      let call = 0;
      const provider: LLMProviderInterface = {
        async generate(): Promise<string> { return ''; },
        async generateWithTools(): Promise<string> {
          call++;
          if (call === 1) return '{"name":"clear_text","arguments":{}}';
          return '{"name":"task_complete","arguments":{"summary":"cleared"}}';
        },
      };

      const loop = new AgentLoop({ provider, maxSteps: 5, settleMs: 0 });
      await collectEvents(loop, 'clear the focused field');

      expect(mockController.performAction).toHaveBeenCalledWith('search-field', 'clearText');
    });
  });

  describe('press_enter tool', () => {
    it('calls performAction with imeEnter on the provided nodeId', async () => {
      let call = 0;
      const provider: LLMProviderInterface = {
        async generate(): Promise<string> { return ''; },
        async generateWithTools(): Promise<string> {
          call++;
          if (call === 1) return '{"name":"press_enter","arguments":{"nodeId":"search-btn"}}';
          return '{"name":"task_complete","arguments":{"summary":"submitted"}}';
        },
      };

      const loop = new AgentLoop({ provider, maxSteps: 5, settleMs: 0 });
      await collectEvents(loop, 'submit the search');

      expect(mockController.performAction).toHaveBeenCalledWith('search-btn', 'imeEnter');
    });

    it('auto-detects focused editable and submits it when nodeId is omitted', async () => {
      mockController.getAccessibilityTree.mockResolvedValue({
        nodeId: 'root',
        className: 'FrameLayout',
        children: [
          {
            nodeId: 'url-bar',
            className: 'EditText',
            text: 'https://example.com',
            isFocused: true,
            isEditable: true,
            children: [],
          },
        ],
      });

      let call = 0;
      const provider: LLMProviderInterface = {
        async generate(): Promise<string> { return ''; },
        async generateWithTools(): Promise<string> {
          call++;
          if (call === 1) return '{"name":"press_enter","arguments":{}}';
          return '{"name":"task_complete","arguments":{"summary":"navigated"}}';
        },
      };

      const loop = new AgentLoop({ provider, maxSteps: 5, settleMs: 0 });
      await collectEvents(loop, 'navigate to url');

      expect(mockController.performAction).toHaveBeenCalledWith('url-bar', 'imeEnter');
    });
  });

  describe('scroll tool auto-detect', () => {
    it('auto-detects the first scrollable node when nodeId is omitted', async () => {
      mockController.getAccessibilityTree.mockResolvedValue({
        nodeId: 'root',
        className: 'FrameLayout',
        isScrollable: false,
        children: [
          {
            nodeId: 'list-view',
            className: 'RecyclerView',
            isScrollable: true,
            children: [],
          },
        ],
      });

      let call = 0;
      const provider: LLMProviderInterface = {
        async generate(): Promise<string> { return ''; },
        async generateWithTools(): Promise<string> {
          call++;
          if (call === 1) return '{"name":"scroll","arguments":{"direction":"down"}}';
          return '{"name":"task_complete","arguments":{"summary":"scrolled"}}';
        },
      };

      const loop = new AgentLoop({ provider, maxSteps: 5, settleMs: 0 });
      await collectEvents(loop, 'scroll down the list');

      expect(mockController.scrollNode).toHaveBeenCalledWith('list-view', 'down');
    });

    it('emits error when no scrollable node and no nodeId given', async () => {
      // Default mock tree has no scrollable node
      let call = 0;
      const provider: LLMProviderInterface = {
        async generate(): Promise<string> { return ''; },
        async generateWithTools(): Promise<string> {
          call++;
          if (call === 1) return '{"name":"scroll","arguments":{"direction":"up"}}';
          return '{"name":"task_complete","arguments":{"summary":"done"}}';
        },
      };

      const loop = new AgentLoop({ provider, maxSteps: 5, settleMs: 0 });
      const events = await collectEvents(loop, 'scroll on flat screen');

      const errorEvent = events.find((e) => e.type === 'error');
      expect(errorEvent).toBeDefined();
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

  describe('timeoutMs', () => {
    afterEach(() => jest.restoreAllMocks());

    it('emits timeout event when elapsed time exceeds timeoutMs', async () => {
      // Provider never finishes — always taps so the loop keeps iterating.
      const loopingProvider: LLMProviderInterface = {
        async generate() { return ''; },
        async generateWithTools() {
          return '{"name":"tap","arguments":{"nodeId":"x"}}';
        },
      };

      // Simulate time: startTime=0, first iteration check returns 6000 (>5000).
      let callCount = 0;
      jest.spyOn(Date, 'now').mockImplementation(() => callCount++ === 0 ? 0 : 6000);

      const loop = new AgentLoop({
        provider: loopingProvider,
        timeoutMs: 5000,
        settleMs: 0,
        maxSteps: 20,
      });

      const events = await collectEvents(loop, 'loop forever');
      const timeoutEvent = events.find((e) => e.type === 'timeout');
      expect(timeoutEvent).toBeDefined();
      expect(events.find((e) => e.type === 'max_steps_reached')).toBeUndefined();
    });

    it('invokes onTimeout callback when the loop times out', async () => {
      const loopingProvider: LLMProviderInterface = {
        async generate() { return ''; },
        async generateWithTools() {
          return '{"name":"tap","arguments":{"nodeId":"x"}}';
        },
      };

      let callCount = 0;
      jest.spyOn(Date, 'now').mockImplementation(() => callCount++ === 0 ? 0 : 6000);

      const onTimeout = jest.fn();
      const loop = new AgentLoop({
        provider: loopingProvider,
        timeoutMs: 5000,
        settleMs: 0,
        maxSteps: 20,
        onTimeout,
      });

      await collectEvents(loop, 'timeout callback test');
      expect(onTimeout).toHaveBeenCalledTimes(1);
    });

    it('does not emit timeout when timeoutMs is 0 (disabled)', async () => {
      const loop = new AgentLoop({
        provider: makeCompletingProvider(),
        timeoutMs: 0,
        settleMs: 0,
      });

      const events = await collectEvents(loop, 'quick task');
      expect(events.find((e) => e.type === 'timeout')).toBeUndefined();
      expect(events.find((e) => e.type === 'complete')).toBeDefined();
    });
  });

  // ---------------------------------------------------------------------------
  // toolFilter
  // ---------------------------------------------------------------------------

  describe('toolFilter', () => {
    it('passes only filtered tools to the provider', async () => {
      const capturedTools: string[] = [];
      const provider: LLMProviderInterface = {
        async generate() { return ''; },
        async generateWithTools(_prompt, tools) {
          capturedTools.push(...tools.map((t) => t.name));
          return '{"name":"task_complete","arguments":{"summary":"done"}}';
        },
      };

      const loop = new AgentLoop({
        provider,
        settleMs: 0,
        toolFilter: ['read_screen', 'screenshot'],
      });

      await collectEvents(loop, 'read-only task');

      const unique = [...new Set(capturedTools)];
      expect(unique).toContain('read_screen');
      expect(unique).toContain('screenshot');
      expect(unique).toContain('task_complete');
      expect(unique).toContain('task_failed');
      // Navigation tools must be absent
      expect(unique).not.toContain('tap');
      expect(unique).not.toContain('swipe');
    });

    it('always includes task_complete and task_failed even if omitted from filter', async () => {
      const capturedTools: string[] = [];
      const provider: LLMProviderInterface = {
        async generate() { return ''; },
        async generateWithTools(_prompt, tools) {
          capturedTools.push(...tools.map((t) => t.name));
          return '{"name":"task_complete","arguments":{"summary":"done"}}';
        },
      };

      // Filter explicitly excludes task_complete and task_failed
      const loop = new AgentLoop({
        provider,
        settleMs: 0,
        toolFilter: ['tap'],
      });

      await collectEvents(loop, 'tap-only task');

      const unique = [...new Set(capturedTools)];
      expect(unique).toContain('tap');
      expect(unique).toContain('task_complete');
      expect(unique).toContain('task_failed');
    });

    it('passes all PHONE_TOOLS when toolFilter is not specified', async () => {
      const capturedTools: string[] = [];
      const provider: LLMProviderInterface = {
        async generate() { return ''; },
        async generateWithTools(_prompt, tools) {
          capturedTools.push(...tools.map((t) => t.name));
          return '{"name":"task_complete","arguments":{"summary":"done"}}';
        },
      };

      const loop = new AgentLoop({ provider, settleMs: 0 });
      await collectEvents(loop, 'full tools task');

      const unique = [...new Set(capturedTools)];
      // Verify a broad set of tools are present
      for (const name of ['tap', 'swipe', 'scroll', 'type_text', 'open_app',
        'global_action', 'read_screen', 'screenshot', 'wait', 'find_node', 'find_all_nodes',
        'task_complete', 'task_failed']) {
        expect(unique).toContain(name);
      }
    });
  });

  describe('maxHistoryItems', () => {
    it('prefixes the prompt with omitted count when history exceeds limit', async () => {
      // Provider: tap 3 times then complete. Each tap step produces an action + observation
      // event, so after 3 steps the history has 6 relevant items.
      // With maxHistoryItems=4, 2 earlier items are dropped.
      let call = 0;
      const capturedPrompts: string[] = [];
      const provider: LLMProviderInterface = {
        async generate() { return ''; },
        async generateWithTools(prompt: string): Promise<string> {
          capturedPrompts.push(prompt);
          call++;
          if (call <= 3) return '{"name":"tap","arguments":{"nodeId":"btn"}}';
          return '{"name":"task_complete","arguments":{"summary":"done"}}';
        },
      };

      const loop = new AgentLoop({ provider, settleMs: 0, maxHistoryItems: 4 });
      await collectEvents(loop, 'multi-step task');

      // The 4th prompt has history from the 3 completed steps (6 items).
      // With maxHistoryItems=4, 2 are omitted.
      const fourthPrompt = capturedPrompts[3];
      expect(fourthPrompt).toBeDefined();
      expect(fourthPrompt).toContain('[2 earlier actions omitted]');
    });

    it('includes all history entries when maxHistoryItems is 0 (no limit)', async () => {
      let call = 0;
      const capturedPrompts: string[] = [];
      const provider: LLMProviderInterface = {
        async generate() { return ''; },
        async generateWithTools(prompt: string): Promise<string> {
          capturedPrompts.push(prompt);
          call++;
          if (call <= 3) return '{"name":"tap","arguments":{"nodeId":"btn"}}';
          return '{"name":"task_complete","arguments":{"summary":"done"}}';
        },
      };

      const loop = new AgentLoop({ provider, settleMs: 0, maxHistoryItems: 0 });
      await collectEvents(loop, 'multi-step no limit');

      const fourthPrompt = capturedPrompts[3];
      expect(fourthPrompt).toBeDefined();
      // No omitted prefix
      expect(fourthPrompt).not.toContain('earlier actions omitted');
      // All 3 step observations should be present
      expect(fourthPrompt).toContain('Step 1: observed screen');
      expect(fourthPrompt).toContain('Step 2: observed screen');
      expect(fourthPrompt).toContain('Step 3: observed screen');
    });

    it('does not prune when history is within the limit', async () => {
      let call = 0;
      const capturedPrompts: string[] = [];
      const provider: LLMProviderInterface = {
        async generate() { return ''; },
        async generateWithTools(prompt: string): Promise<string> {
          capturedPrompts.push(prompt);
          call++;
          if (call === 1) return '{"name":"tap","arguments":{"nodeId":"btn"}}';
          return '{"name":"task_complete","arguments":{"summary":"done"}}';
        },
      };

      // After 1 tap step: 2 relevant items (action + observation). Limit=10 → no pruning.
      const loop = new AgentLoop({ provider, settleMs: 0, maxHistoryItems: 10 });
      await collectEvents(loop, 'single step within limit');

      const secondPrompt = capturedPrompts[1];
      expect(secondPrompt).toBeDefined();
      expect(secondPrompt).not.toContain('earlier actions omitted');
    });
  });

  describe('registerTool', () => {
    it('custom tool is passed to the provider in the tools list', async () => {
      const capturedTools: string[] = [];
      const provider: LLMProviderInterface = {
        async generate() { return ''; },
        async generateWithTools(_prompt, tools) {
          capturedTools.push(...tools.map((t) => t.name));
          return '{"name":"task_complete","arguments":{"summary":"done"}}';
        },
      };

      const loop = new AgentLoop({ provider, settleMs: 0 });
      loop.registerTool(
        {
          name: 'copy_text',
          description: 'Copy text between fields',
          parameters: { type: 'object', properties: {
            sourceNodeId: { type: 'string' },
            targetNodeId: { type: 'string' },
          }, required: ['sourceNodeId', 'targetNodeId'] },
        },
        async () => true,
      );

      await collectEvents(loop, 'custom tool task');

      expect([...new Set(capturedTools)]).toContain('copy_text');
    });

    it('custom tool handler is invoked when the LLM calls it', async () => {
      const handlerCalled: Record<string, unknown>[] = [];
      // Second provider call (after observing screen) returns task_complete
      let calls = 0;
      const tieredProvider: LLMProviderInterface = {
        async generate() { return ''; },
        async generateWithTools() {
          calls++;
          if (calls === 1) return '{"name":"my_tool","arguments":{"value":"hello"}}';
          return '{"name":"task_complete","arguments":{"summary":"done"}}';
        },
      };

      const loop = new AgentLoop({ provider: tieredProvider, settleMs: 0 });
      loop.registerTool(
        {
          name: 'my_tool',
          description: 'A custom tool',
          parameters: { type: 'object', properties: { value: { type: 'string' } } },
        },
        async (args) => {
          handlerCalled.push(args);
          return 'result';
        },
      );

      await collectEvents(loop, 'invoke custom tool');

      expect(handlerCalled).toHaveLength(1);
      expect(handlerCalled[0]).toEqual({ value: 'hello' });
    });

    it('registering the same tool name twice replaces the handler', async () => {
      const first: number[] = [];
      const second: number[] = [];
      let calls = 0;
      const tieredProvider: LLMProviderInterface = {
        async generate() { return ''; },
        async generateWithTools() {
          calls++;
          if (calls === 1) return '{"name":"my_tool","arguments":{}}';
          return '{"name":"task_complete","arguments":{"summary":"done"}}';
        },
      };

      const myTool = {
        name: 'my_tool',
        description: 'tool',
        parameters: { type: 'object' as const, properties: {} },
      };

      const loop = new AgentLoop({ provider: tieredProvider, settleMs: 0 });
      loop.registerTool(myTool, async () => { first.push(1); return true; });
      loop.registerTool(myTool, async () => { second.push(1); return true; });

      await collectEvents(loop, 'double-register task');

      // Second handler should run; tool should appear only once in tools list
      expect(second).toHaveLength(1);
      expect(first).toHaveLength(0);
    });

    it('does not add duplicate entry to tools array on repeated registration', async () => {
      const capturedLengths: number[] = [];
      const provider: LLMProviderInterface = {
        async generate() { return ''; },
        async generateWithTools(_prompt, tools) {
          capturedLengths.push(tools.filter((t) => t.name === 'dup_tool').length);
          return '{"name":"task_complete","arguments":{"summary":"done"}}';
        },
      };

      const loop = new AgentLoop({ provider, settleMs: 0 });
      const myTool = {
        name: 'dup_tool',
        description: 'dup',
        parameters: { type: 'object' as const, properties: {} },
      };
      loop.registerTool(myTool, async () => true);
      loop.registerTool(myTool, async () => false);

      await collectEvents(loop, 'dup register task');

      expect(capturedLengths[0]).toBe(1);
    });
  });

  // ---------------------------------------------------------------------------
  // context injection
  // ---------------------------------------------------------------------------

  describe('context injection', () => {
    it('includes context key-value pairs in the prompt', async () => {
      const capturedPrompts: string[] = [];
      const provider: LLMProviderInterface = {
        async generate() { return ''; },
        async generateWithTools(prompt): Promise<string> {
          capturedPrompts.push(prompt);
          return '{"name":"task_complete","arguments":{"summary":"done"}}';
        },
      };

      const loop = new AgentLoop({
        provider,
        settleMs: 0,
        context: { username: 'Matt', language: 'Spanish' },
      });
      await collectEvents(loop, 'context test task');

      expect(capturedPrompts[0]).toContain('username: Matt');
      expect(capturedPrompts[0]).toContain('language: Spanish');
    });

    it('omits the context section when context is empty', async () => {
      const capturedPrompts: string[] = [];
      const provider: LLMProviderInterface = {
        async generate() { return ''; },
        async generateWithTools(prompt): Promise<string> {
          capturedPrompts.push(prompt);
          return '{"name":"task_complete","arguments":{"summary":"done"}}';
        },
      };

      const loop = new AgentLoop({ provider, settleMs: 0, context: {} });
      await collectEvents(loop, 'no context task');

      expect(capturedPrompts[0]).not.toContain('Context:');
    });

    it('omits the context section when context is not provided', async () => {
      const capturedPrompts: string[] = [];
      const provider: LLMProviderInterface = {
        async generate() { return ''; },
        async generateWithTools(prompt): Promise<string> {
          capturedPrompts.push(prompt);
          return '{"name":"task_complete","arguments":{"summary":"done"}}';
        },
      };

      const loop = new AgentLoop({ provider, settleMs: 0 });
      await collectEvents(loop, 'no context option');

      expect(capturedPrompts[0]).not.toContain('Context:');
    });

    it('injects context label header when at least one key is present', async () => {
      const capturedPrompts: string[] = [];
      const provider: LLMProviderInterface = {
        async generate() { return ''; },
        async generateWithTools(prompt): Promise<string> {
          capturedPrompts.push(prompt);
          return '{"name":"task_complete","arguments":{"summary":"done"}}';
        },
      };

      const loop = new AgentLoop({
        provider,
        settleMs: 0,
        context: { role: 'admin' },
      });
      await collectEvents(loop, 'single context key');

      expect(capturedPrompts[0]).toContain('Context:');
      expect(capturedPrompts[0]).toContain('role: admin');
    });
  });

  // ---------------------------------------------------------------------------
  // onProgress callback
  // ---------------------------------------------------------------------------

  describe('onProgress callback', () => {
    it('fires with step and maxSteps after each observation', async () => {
      const progressCalls: Array<[number, number]> = [];
      let call = 0;
      const provider: LLMProviderInterface = {
        async generate() { return ''; },
        async generateWithTools(): Promise<string> {
          call++;
          if (call === 1) return '{"name":"tap","arguments":{"nodeId":"x"}}';
          return '{"name":"task_complete","arguments":{"summary":"done"}}';
        },
      };

      const loop = new AgentLoop({
        provider,
        settleMs: 0,
        maxSteps: 10,
        onProgress: (step, maxSteps) => progressCalls.push([step, maxSteps]),
      });
      await collectEvents(loop, 'progress callback test');

      expect(progressCalls.length).toBeGreaterThan(0);
      expect(progressCalls[0]).toEqual([1, 10]);
    });

    it('is not invoked when the task completes on the first step without an observation', async () => {
      const progressCalls: Array<[number, number]> = [];
      const provider: LLMProviderInterface = {
        async generate() { return ''; },
        async generateWithTools(): Promise<string> {
          return '{"name":"task_complete","arguments":{"summary":"done"}}';
        },
      };

      const loop = new AgentLoop({
        provider,
        settleMs: 0,
        maxSteps: 10,
        onProgress: (step, maxSteps) => progressCalls.push([step, maxSteps]),
      });
      await collectEvents(loop, 'immediate complete');

      expect(progressCalls).toHaveLength(0);
    });

    it('reports the correct maxSteps value', async () => {
      const progressCalls: Array<[number, number]> = [];
      let call = 0;
      const provider: LLMProviderInterface = {
        async generate() { return ''; },
        async generateWithTools(): Promise<string> {
          call++;
          if (call <= 2) return '{"name":"tap","arguments":{"nodeId":"x"}}';
          return '{"name":"task_complete","arguments":{"summary":"done"}}';
        },
      };

      const loop = new AgentLoop({
        provider,
        settleMs: 0,
        maxSteps: 7,
        onProgress: (step, maxSteps) => progressCalls.push([step, maxSteps]),
      });
      await collectEvents(loop, 'maxSteps check');

      expect(progressCalls.every(([, max]) => max === 7)).toBe(true);
    });
  });
});
