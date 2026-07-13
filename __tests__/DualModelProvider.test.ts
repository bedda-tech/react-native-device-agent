import { DualModelProvider } from '../src/providers/DualModelProvider';
import type { LLMProviderInterface, Tool } from '../src/types';

const TOOLS: Tool[] = [
  {
    name: 'tap',
    description: 'Tap a node',
    parameters: {
      type: 'object',
      properties: { nodeId: { type: 'string', description: 'Node ID' } },
      required: ['nodeId'],
    },
  },
];

function makeMockProvider(
  suffix: string,
): jest.Mocked<LLMProviderInterface> & { generateWithVision: jest.Mock } {
  return {
    generate: jest.fn().mockResolvedValue(`generate:${suffix}`),
    generateWithTools: jest.fn().mockResolvedValue(`generateWithTools:${suffix}`),
    generateWithVision: jest.fn().mockResolvedValue(`generateWithVision:${suffix}`),
  };
}

describe('DualModelProvider', () => {
  describe('generate routing', () => {
    it('routes generate to reasoningProvider', async () => {
      const reasoning = makeMockProvider('reasoning');
      const dispatch = makeMockProvider('dispatch');
      const provider = new DualModelProvider({ reasoningProvider: reasoning, dispatchProvider: dispatch });

      const result = await provider.generate('plan this task');
      expect(result).toBe('generate:reasoning');
      expect(reasoning.generate).toHaveBeenCalledWith('plan this task');
      expect(dispatch.generate).not.toHaveBeenCalled();
    });
  });

  describe('generateWithTools routing', () => {
    it('routes generateWithTools to dispatchProvider when configured', async () => {
      const reasoning = makeMockProvider('reasoning');
      const dispatch = makeMockProvider('dispatch');
      const provider = new DualModelProvider({ reasoningProvider: reasoning, dispatchProvider: dispatch });

      const result = await provider.generateWithTools('tap button', TOOLS);
      expect(result).toBe('generateWithTools:dispatch');
      expect(dispatch.generateWithTools).toHaveBeenCalledWith('tap button', TOOLS);
      expect(reasoning.generateWithTools).not.toHaveBeenCalled();
    });

    it('falls back to reasoningProvider when no dispatchProvider configured', async () => {
      const reasoning = makeMockProvider('reasoning');
      const provider = new DualModelProvider({ reasoningProvider: reasoning });

      const result = await provider.generateWithTools('tap button', TOOLS);
      expect(result).toBe('generateWithTools:reasoning');
      expect(reasoning.generateWithTools).toHaveBeenCalledWith('tap button', TOOLS);
    });

    it('falls back to reasoningProvider when dispatchProvider throws', async () => {
      const reasoning = makeMockProvider('reasoning');
      const dispatch = makeMockProvider('dispatch');
      dispatch.generateWithTools.mockRejectedValue(new Error('dispatch OOM'));
      const provider = new DualModelProvider({ reasoningProvider: reasoning, dispatchProvider: dispatch });

      const result = await provider.generateWithTools('tap button', TOOLS);
      expect(result).toBe('generateWithTools:reasoning');
      expect(reasoning.generateWithTools).toHaveBeenCalledWith('tap button', TOOLS);
    });
  });

  describe('generateWithVision routing', () => {
    it('routes generateWithVision to reasoningProvider', async () => {
      const reasoning = makeMockProvider('reasoning');
      const dispatch = makeMockProvider('dispatch');
      const provider = new DualModelProvider({ reasoningProvider: reasoning, dispatchProvider: dispatch });

      const result = await provider.generateWithVision('describe screen', TOOLS, '/tmp/shot.png');
      expect(result).toBe('generateWithVision:reasoning');
      expect(reasoning.generateWithVision).toHaveBeenCalledWith('describe screen', TOOLS, '/tmp/shot.png');
      expect(dispatch.generateWithVision).not.toHaveBeenCalled();
    });

    it('falls back to generateWithTools if reasoningProvider has no vision', async () => {
      const reasoning: LLMProviderInterface = {
        generate: jest.fn().mockResolvedValue('generate:reasoning'),
        generateWithTools: jest.fn().mockResolvedValue('generateWithTools:reasoning'),
      };
      const provider = new DualModelProvider({ reasoningProvider: reasoning });

      const result = await provider.generateWithVision('describe screen', TOOLS, '/tmp/shot.png');
      expect(result).toBe('generateWithTools:reasoning');
      expect(reasoning.generateWithTools).toHaveBeenCalledWith('describe screen', TOOLS);
    });
  });

  describe('lazy-load dispatchProvider', () => {
    it('calls loadDispatchProvider factory only once on first generateWithTools', async () => {
      const reasoning = makeMockProvider('reasoning');
      const dispatch = makeMockProvider('dispatch');
      const factory = jest.fn().mockResolvedValue(dispatch);

      const provider = new DualModelProvider({
        reasoningProvider: reasoning,
        loadDispatchProvider: factory,
      });

      expect(factory).not.toHaveBeenCalled();
      expect(provider.isDispatchReady).toBe(false);

      await provider.generateWithTools('tap', TOOLS);
      expect(factory).toHaveBeenCalledTimes(1);
      expect(provider.isDispatchReady).toBe(true);

      // Second call reuses cached provider, no second factory invocation
      await provider.generateWithTools('tap again', TOOLS);
      expect(factory).toHaveBeenCalledTimes(1);
      expect(dispatch.generateWithTools).toHaveBeenCalledTimes(2);
    });

    it('concurrent calls share the same loading promise (no double-init)', async () => {
      const reasoning = makeMockProvider('reasoning');
      const dispatch = makeMockProvider('dispatch');
      let resolveFn!: (p: LLMProviderInterface) => void;
      const loadingPromise = new Promise<LLMProviderInterface>((res) => { resolveFn = res; });
      const factory = jest.fn().mockReturnValue(loadingPromise);

      const provider = new DualModelProvider({
        reasoningProvider: reasoning,
        loadDispatchProvider: factory,
      });

      // Fire two concurrent calls
      const p1 = provider.generateWithTools('call1', TOOLS);
      const p2 = provider.generateWithTools('call2', TOOLS);

      // Resolve the factory
      resolveFn(dispatch);

      await Promise.all([p1, p2]);

      expect(factory).toHaveBeenCalledTimes(1);
      expect(dispatch.generateWithTools).toHaveBeenCalledTimes(2);
    });

    it('falls back to reasoningProvider if factory rejects', async () => {
      const reasoning = makeMockProvider('reasoning');
      const factory = jest.fn().mockRejectedValue(new Error('load failed'));

      const provider = new DualModelProvider({
        reasoningProvider: reasoning,
        loadDispatchProvider: factory,
      });

      // factory rejects → resolveDispatch throws → caught → falls back to reasoning
      const result = await provider.generateWithTools('tap', TOOLS);
      expect(result).toBe('generateWithTools:reasoning');
      expect(reasoning.generateWithTools).toHaveBeenCalledWith('tap', TOOLS);
    });
  });

  describe('dispatchToolFilter', () => {
    const ALL_TOOLS: Tool[] = [
      {
        name: 'tap',
        description: 'Tap a node',
        parameters: { type: 'object', properties: { nodeId: { type: 'string', description: 'Node' } }, required: ['nodeId'] },
      },
      {
        name: 'type_text',
        description: 'Type text',
        parameters: { type: 'object', properties: { text: { type: 'string', description: 'Text' } }, required: ['text'] },
      },
      {
        name: 'scroll',
        description: 'Scroll',
        parameters: { type: 'object', properties: { direction: { type: 'string', description: 'Dir' } }, required: ['direction'] },
      },
    ];

    it('passes only filtered tools to dispatchProvider', async () => {
      const reasoning = makeMockProvider('reasoning');
      const dispatch = makeMockProvider('dispatch');
      const provider = new DualModelProvider({
        reasoningProvider: reasoning,
        dispatchProvider: dispatch,
        dispatchToolFilter: ['tap', 'type_text'],
      });

      await provider.generateWithTools('fill form', ALL_TOOLS);

      const [, calledTools] = dispatch.generateWithTools.mock.calls[0];
      expect((calledTools as Tool[]).map((t: Tool) => t.name)).toEqual(['tap', 'type_text']);
      expect(reasoning.generateWithTools).not.toHaveBeenCalled();
    });

    it('passes full tool list when dispatchToolFilter is not set', async () => {
      const reasoning = makeMockProvider('reasoning');
      const dispatch = makeMockProvider('dispatch');
      const provider = new DualModelProvider({
        reasoningProvider: reasoning,
        dispatchProvider: dispatch,
      });

      await provider.generateWithTools('do task', ALL_TOOLS);

      const [, calledTools] = dispatch.generateWithTools.mock.calls[0];
      expect((calledTools as Tool[]).length).toBe(ALL_TOOLS.length);
    });

    it('passes empty tools array to dispatch when filter matches nothing', async () => {
      const reasoning = makeMockProvider('reasoning');
      const dispatch = makeMockProvider('dispatch');
      const provider = new DualModelProvider({
        reasoningProvider: reasoning,
        dispatchProvider: dispatch,
        dispatchToolFilter: ['nonexistent_tool'],
      });

      await provider.generateWithTools('do task', ALL_TOOLS);

      const [, calledTools] = dispatch.generateWithTools.mock.calls[0];
      expect((calledTools as Tool[]).length).toBe(0);
    });

    it('passes full tool list to reasoningProvider on dispatch fallback', async () => {
      const reasoning = makeMockProvider('reasoning');
      const dispatch = makeMockProvider('dispatch');
      dispatch.generateWithTools.mockRejectedValue(new Error('OOM'));
      const provider = new DualModelProvider({
        reasoningProvider: reasoning,
        dispatchProvider: dispatch,
        dispatchToolFilter: ['tap'],
      });

      await provider.generateWithTools('do task', ALL_TOOLS);

      const [, reasoningTools] = reasoning.generateWithTools.mock.calls[0];
      expect((reasoningTools as Tool[]).length).toBe(ALL_TOOLS.length);
    });
  });

  describe('isDispatchReady', () => {
    it('returns false when no dispatch provider configured', () => {
      const reasoning = makeMockProvider('reasoning');
      const provider = new DualModelProvider({ reasoningProvider: reasoning });
      expect(provider.isDispatchReady).toBe(false);
    });

    it('returns true immediately when static dispatchProvider given', () => {
      const reasoning = makeMockProvider('reasoning');
      const dispatch = makeMockProvider('dispatch');
      const provider = new DualModelProvider({ reasoningProvider: reasoning, dispatchProvider: dispatch });
      expect(provider.isDispatchReady).toBe(true);
    });

    it('returns false before lazy load, true after', async () => {
      const reasoning = makeMockProvider('reasoning');
      const dispatch = makeMockProvider('dispatch');
      const factory = jest.fn().mockResolvedValue(dispatch);
      const provider = new DualModelProvider({
        reasoningProvider: reasoning,
        loadDispatchProvider: factory,
      });

      expect(provider.isDispatchReady).toBe(false);
      await provider.generateWithTools('tap', TOOLS);
      expect(provider.isDispatchReady).toBe(true);
    });
  });
});
