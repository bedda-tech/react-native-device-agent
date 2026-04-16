/**
 * Tests for useAgent + useAgentChat hook behaviour via the AgentLoop with a
 * mock LLM provider. No native module required -- react-native-accessibility-
 * controller is mocked in jest.setup below.
 */

import type { LLMProviderInterface, Tool } from '../types';
import { AgentLoop } from '../agent/AgentLoop';

// ---------------------------------------------------------------------------
// Mock the native peer dependency
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
// Mock provider helpers
// ---------------------------------------------------------------------------

/**
 * A provider that immediately responds with task_complete.
 */
class CompleteImmediatelyProvider implements LLMProviderInterface {
  private readonly summary: string;

  constructor(summary = 'Task done.') {
    this.summary = summary;
  }

  async generate(_prompt: string): Promise<string> {
    return `{"name":"task_complete","arguments":{"summary":"${this.summary}"}}`;
  }

  async generateWithTools(_prompt: string, _tools: Tool[]): Promise<string> {
    return `{"name":"task_complete","arguments":{"summary":"${this.summary}"}}`;
  }
}

/**
 * A provider that performs one tap action then completes.
 */
class TapThenCompleteProvider implements LLMProviderInterface {
  private callCount = 0;

  async generate(_prompt: string): Promise<string> {
    return this.generateWithTools(_prompt, []);
  }

  async generateWithTools(_prompt: string, _tools: Tool[]): Promise<string> {
    this.callCount++;
    if (this.callCount === 1) {
      return '{"name":"tap","arguments":{"x":100,"y":200}}';
    }
    return '{"name":"task_complete","arguments":{"summary":"Tapped and done."}}';
  }
}

/**
 * A provider that emits thinking text before a task_complete call.
 */
class ThinkingProvider implements LLMProviderInterface {
  async generate(_prompt: string): Promise<string> {
    return this.generateWithTools(_prompt, []);
  }

  async generateWithTools(_prompt: string, _tools: Tool[]): Promise<string> {
    return 'I should finish now. {"name":"task_complete","arguments":{"summary":"Done after thinking."}}';
  }
}

/**
 * A provider that always throws an error.
 */
class ErrorProvider implements LLMProviderInterface {
  async generate(_prompt: string): Promise<string> {
    throw new Error('LLM inference failed');
  }

  async generateWithTools(_prompt: string, _tools: Tool[]): Promise<string> {
    throw new Error('LLM inference failed');
  }
}

// ---------------------------------------------------------------------------
// AgentLoop tests (the core that useAgent/useAgentChat consume)
// ---------------------------------------------------------------------------

describe('AgentLoop with mock provider', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockController.getAccessibilityTree.mockResolvedValue({
      nodeId: 'root',
      text: 'Home screen',
      children: [],
    });
  });

  it('emits complete event when provider returns task_complete immediately', async () => {
    const provider = new CompleteImmediatelyProvider('All done!');
    const loop = new AgentLoop({ provider, maxSteps: 5, settleMs: 0 });

    const events = [];
    for await (const event of loop.run('Open Settings')) {
      events.push(event);
    }

    const completeEvent = events.find((e) => e.type === 'complete');
    expect(completeEvent).toBeDefined();
    expect(completeEvent?.type === 'complete' && completeEvent.result).toBe('All done!');
  });

  it('emits action event then complete event for tap-then-complete provider', async () => {
    const provider = new TapThenCompleteProvider();
    const loop = new AgentLoop({ provider, maxSteps: 10, settleMs: 0 });

    const events = [];
    for await (const event of loop.run('Tap the button')) {
      events.push(event);
    }

    const actionEvent = events.find((e) => e.type === 'action');
    expect(actionEvent).toBeDefined();
    expect(actionEvent?.type === 'action' && actionEvent.tool).toBe('tap');

    const completeEvent = events.find((e) => e.type === 'complete');
    expect(completeEvent).toBeDefined();
    expect(
      completeEvent?.type === 'complete' && completeEvent.result,
    ).toBe('Tapped and done.');
  });

  it('emits thinking event when provider returns text before JSON', async () => {
    const provider = new ThinkingProvider();
    const loop = new AgentLoop({ provider, maxSteps: 5, settleMs: 0 });

    const events = [];
    for await (const event of loop.run('Think then act')) {
      events.push(event);
    }

    const thinkingEvent = events.find((e) => e.type === 'thinking');
    expect(thinkingEvent).toBeDefined();
    expect(
      thinkingEvent?.type === 'thinking' && thinkingEvent.content,
    ).toContain('I should finish now.');
  });

  it('emits error event when provider throws', async () => {
    const provider = new ErrorProvider();
    const loop = new AgentLoop({ provider, maxSteps: 5, settleMs: 0 });

    const events = [];
    for await (const event of loop.run('Fail gracefully')) {
      events.push(event);
    }

    const errorEvent = events.find((e) => e.type === 'error');
    expect(errorEvent).toBeDefined();
    expect(
      errorEvent?.type === 'error' && errorEvent.error.message,
    ).toBe('LLM inference failed');
  });

  it('stops when abort() is called mid-run', async () => {
    // Provider that never completes (always taps)
    const neverCompletingProvider: LLMProviderInterface = {
      generate: async () => '{"name":"tap","arguments":{"x":1,"y":1}}',
      generateWithTools: async () => '{"name":"tap","arguments":{"x":1,"y":1}}',
    };

    const loop = new AgentLoop({ provider: neverCompletingProvider, maxSteps: 100, settleMs: 0 });
    const events: Array<{ type: string }> = [];

    let abortAfter = 2;
    for await (const event of loop.run('Run indefinitely')) {
      events.push(event);
      abortAfter--;
      if (abortAfter <= 0) {
        loop.abort();
      }
    }

    // After abort, we should not see a complete event
    const completeEvent = events.find((e) => e.type === 'complete');
    expect(completeEvent).toBeUndefined();
    // And we should have received at least one event before abort
    expect(events.length).toBeGreaterThan(0);
  });

  it('emits max_steps_reached when steps are exhausted', async () => {
    const neverCompletingProvider: LLMProviderInterface = {
      generate: async () => '{"name":"tap","arguments":{"x":1,"y":1}}',
      generateWithTools: async () => '{"name":"tap","arguments":{"x":1,"y":1}}',
    };

    const loop = new AgentLoop({ provider: neverCompletingProvider, maxSteps: 2, settleMs: 0 });

    const events = [];
    for await (const event of loop.run('Run until max steps')) {
      events.push(event);
    }

    const maxStepsEvent = events.find((e) => e.type === 'max_steps_reached');
    expect(maxStepsEvent).toBeDefined();
  });
});
