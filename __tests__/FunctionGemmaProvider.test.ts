import { FunctionGemmaProvider } from '../src/providers/FunctionGemmaProvider';
import type { Tool } from '../src/types';

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
  {
    name: 'task_complete',
    description: 'Signal task done',
    parameters: {
      type: 'object',
      properties: { summary: { type: 'string', description: 'Summary' } },
      required: ['summary'],
    },
  },
];

describe('FunctionGemmaProvider', () => {
  describe('constructor', () => {
    it('applies defaults when no options provided', () => {
      const provider = new FunctionGemmaProvider({});
      expect(provider).toBeDefined();
    });

    it('accepts custom maxTokens', () => {
      const provider = new FunctionGemmaProvider({ maxTokens: 64 });
      expect(provider).toBeDefined();
    });
  });

  describe('generate', () => {
    it('passes prompt to generateFn', async () => {
      const generateFn = jest.fn().mockResolvedValue('response');
      const provider = new FunctionGemmaProvider({ generateFn });
      const result = await provider.generate('hello');
      expect(generateFn).toHaveBeenCalledWith('hello');
      expect(result).toBe('response');
    });
  });

  describe('generateWithTools', () => {
    it('builds a dispatch prompt with tool list and calls generateFn', async () => {
      const generateFn = jest.fn().mockResolvedValue('{"name":"tap","arguments":{"nodeId":"btn-1"}}');
      const provider = new FunctionGemmaProvider({ generateFn });

      await provider.generateWithTools('Task: tap the button', TOOLS);

      expect(generateFn).toHaveBeenCalledTimes(1);
      const capturedPrompt: string = generateFn.mock.calls[0][0];
      expect(capturedPrompt).toContain('Available tools:');
      expect(capturedPrompt).toContain('"tap"');
      expect(capturedPrompt).toContain('"task_complete"');
    });

    it('includes the user prompt after the system block', async () => {
      const generateFn = jest.fn().mockResolvedValue('{}');
      const provider = new FunctionGemmaProvider({ generateFn });

      await provider.generateWithTools('Task: tap logout button', TOOLS);

      const capturedPrompt: string = generateFn.mock.calls[0][0];
      expect(capturedPrompt).toContain('Task: tap logout button');
    });

    it('inlines tool schemas as compact JSON (no indentation)', async () => {
      const generateFn = jest.fn().mockResolvedValue('{}');
      const provider = new FunctionGemmaProvider({ generateFn });

      await provider.generateWithTools('tap', TOOLS);

      const capturedPrompt: string = generateFn.mock.calls[0][0];
      // Compact JSON has no newlines inside the array
      const toolsLine = capturedPrompt
        .split('\n')
        .find((l) => l.startsWith('['));
      expect(toolsLine).toBeDefined();
      expect(toolsLine).toContain('"tap"');
    });

    it('returns the raw generateFn response', async () => {
      const expected = '{"name":"task_complete","arguments":{"summary":"done"}}';
      const generateFn = jest.fn().mockResolvedValue(expected);
      const provider = new FunctionGemmaProvider({ generateFn });

      const result = await provider.generateWithTools('complete', TOOLS);
      expect(result).toBe(expected);
    });

    it('propagates errors from generateFn', async () => {
      const generateFn = jest.fn().mockRejectedValue(new Error('OOM'));
      const provider = new FunctionGemmaProvider({ generateFn });

      await expect(provider.generateWithTools('tap', TOOLS)).rejects.toThrow('OOM');
    });
  });

  describe('missing generateFn', () => {
    it('throws a descriptive error if generateFn is not provided', async () => {
      const provider = new FunctionGemmaProvider({});
      await expect(provider.generate('hello')).rejects.toThrow(
        'FunctionGemmaProvider requires a generateFn',
      );
    });

    it('throws for generateWithTools if generateFn is not provided', async () => {
      const provider = new FunctionGemmaProvider({});
      await expect(provider.generateWithTools('tap', TOOLS)).rejects.toThrow(
        'FunctionGemmaProvider requires a generateFn',
      );
    });
  });
});
