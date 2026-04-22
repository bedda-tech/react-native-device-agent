import { GemmaProvider } from '../src/providers/GemmaProvider';
import type { Tool } from '../src/types';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const TOOLS: Tool[] = [
  {
    name: 'tap',
    description: 'Tap a UI element',
    parameters: {
      type: 'object',
      properties: {
        nodeId: { type: 'string', description: 'Accessibility node ID' },
        x: { type: 'number', description: 'X coordinate' },
        y: { type: 'number', description: 'Y coordinate' },
      },
      required: ['nodeId'],
    },
  },
  {
    name: 'type_text',
    description: 'Type text into a focused field',
    parameters: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'Text to type' },
      },
      required: ['text'],
    },
  },
];

// ---------------------------------------------------------------------------
// generate()
// ---------------------------------------------------------------------------

describe('GemmaProvider.generate', () => {
  it('delegates to the injected generateFn', async () => {
    const generateFn = jest.fn().mockResolvedValue('hello');
    const provider = new GemmaProvider({ model: 'GEMMA4_E4B', generateFn });

    const result = await provider.generate('test prompt');

    expect(result).toBe('hello');
    expect(generateFn).toHaveBeenCalledTimes(1);
    expect(generateFn).toHaveBeenCalledWith('test prompt');
  });

  it('throws a helpful error when no generateFn is provided', async () => {
    const provider = new GemmaProvider({ model: 'GEMMA4_E4B' });
    await expect(provider.generate('test')).rejects.toThrow(
      'GemmaProvider requires a generateFn',
    );
  });

  it('propagates errors from generateFn', async () => {
    const generateFn = jest.fn().mockRejectedValue(new Error('inference failed'));
    const provider = new GemmaProvider({ model: 'GEMMA4_E2B', generateFn });
    await expect(provider.generate('test')).rejects.toThrow('inference failed');
  });
});

// ---------------------------------------------------------------------------
// generateWithTools()
// ---------------------------------------------------------------------------

describe('GemmaProvider.generateWithTools', () => {
  it('prepends a tool system prompt to the user prompt', async () => {
    const generateFn = jest.fn().mockResolvedValue('{"name":"tap","arguments":{}}');
    const provider = new GemmaProvider({ model: 'GEMMA4_E4B', generateFn });

    await provider.generateWithTools('Tap the button', TOOLS);

    const calledWith = generateFn.mock.calls[0][0] as string;
    expect(calledWith).toContain('Available tools:');
    expect(calledWith).toContain('"tap"');
    expect(calledWith).toContain('"type_text"');
    expect(calledWith).toContain('Tap the button');
  });

  it('includes tool descriptions in the system prompt', async () => {
    const generateFn = jest.fn().mockResolvedValue('{}');
    const provider = new GemmaProvider({ model: 'GEMMA4_E4B', generateFn });

    await provider.generateWithTools('task', TOOLS);

    const prompt = generateFn.mock.calls[0][0] as string;
    expect(prompt).toContain('Tap a UI element');
    expect(prompt).toContain('Type text into a focused field');
  });

  it('includes required fields for each tool schema', async () => {
    const generateFn = jest.fn().mockResolvedValue('{}');
    const provider = new GemmaProvider({ model: 'GEMMA4_E4B', generateFn });

    await provider.generateWithTools('task', TOOLS);

    const prompt = generateFn.mock.calls[0][0] as string;
    const parsed = JSON.parse(
      prompt.match(/\[.*\]/s)?.[0] ?? '[]',
    ) as Array<{ name: string; parameters: { required: string[] } }>;

    const tap = parsed.find((t) => t.name === 'tap');
    expect(tap?.parameters.required).toEqual(['nodeId']);
  });

  it('handles tools with no required array (defaults to [])', async () => {
    const toolNoRequired: Tool = {
      name: 'wait',
      description: 'Wait for screen to update',
      parameters: { type: 'object', properties: {}, required: undefined },
    };
    const generateFn = jest.fn().mockResolvedValue('{}');
    const provider = new GemmaProvider({ model: 'GEMMA4_E4B', generateFn });

    await expect(
      provider.generateWithTools('task', [toolNoRequired]),
    ).resolves.toBe('{}');

    const prompt = generateFn.mock.calls[0][0] as string;
    expect(prompt).toContain('"required": []');
  });

  it('instructs the model to respond only with JSON', async () => {
    const generateFn = jest.fn().mockResolvedValue('{}');
    const provider = new GemmaProvider({ model: 'GEMMA4_E4B', generateFn });

    await provider.generateWithTools('task', TOOLS);

    const prompt = generateFn.mock.calls[0][0] as string;
    expect(prompt).toContain('respond ONLY with valid JSON');
  });

  it('returns the raw LLM output for ToolParser to handle', async () => {
    const llmResponse = '{"name":"tap","arguments":{"nodeId":"btn-1"}}';
    const generateFn = jest.fn().mockResolvedValue(llmResponse);
    const provider = new GemmaProvider({ model: 'GEMMA4_E4B', generateFn });

    const result = await provider.generateWithTools('Tap the button', TOOLS);

    expect(result).toBe(llmResponse);
  });
});

// ---------------------------------------------------------------------------
// generateWithVision()
// ---------------------------------------------------------------------------

describe('GemmaProvider.generateWithVision', () => {
  it('calls generateWithImageFn when provided', async () => {
    const generateFn = jest.fn().mockResolvedValue('text fallback');
    const generateWithImageFn = jest.fn().mockResolvedValue('vision result');
    const provider = new GemmaProvider({
      model: 'GEMMA4_E4B',
      generateFn,
      generateWithImageFn,
    });

    const result = await provider.generateWithVision(
      'What is on screen?',
      TOOLS,
      '/data/screenshots/screen.png',
    );

    expect(result).toBe('vision result');
    expect(generateWithImageFn).toHaveBeenCalledTimes(1);
    expect(generateFn).not.toHaveBeenCalled();
  });

  it('passes normalized path (no file:// prefix) to generateWithImageFn', async () => {
    const generateWithImageFn = jest.fn().mockResolvedValue('ok');
    const provider = new GemmaProvider({
      model: 'GEMMA4_E4B',
      generateFn: jest.fn(),
      generateWithImageFn,
    });

    await provider.generateWithVision('task', TOOLS, 'file:///data/screen.png');

    const passedPath = generateWithImageFn.mock.calls[0][1] as string;
    expect(passedPath).not.toMatch(/^file:\/\//);
    expect(passedPath).toBe('/data/screen.png');
  });

  it('includes vision-specific prompt context alongside tool system block', async () => {
    const generateWithImageFn = jest.fn().mockResolvedValue('ok');
    const provider = new GemmaProvider({
      model: 'GEMMA4_E4B',
      generateFn: jest.fn(),
      generateWithImageFn,
    });

    await provider.generateWithVision('Do the task', TOOLS, '/tmp/screen.png');

    const calledWith = generateWithImageFn.mock.calls[0][0] as string;
    expect(calledWith).toContain('Available tools:');
    expect(calledWith).toContain('Do the task');
  });

  it('falls back to text-only generateFn when generateWithImageFn is not provided', async () => {
    const generateFn = jest.fn().mockResolvedValue('text-only result');
    const provider = new GemmaProvider({ model: 'GEMMA4_E4B', generateFn });

    const result = await provider.generateWithVision(
      'What is on screen?',
      TOOLS,
      '/tmp/screen.png',
    );

    expect(result).toBe('text-only result');
    expect(generateFn).toHaveBeenCalledTimes(1);
  });

  it('propagates errors from generateWithImageFn', async () => {
    const generateWithImageFn = jest
      .fn()
      .mockRejectedValue(new Error('vision inference failed'));
    const provider = new GemmaProvider({
      model: 'GEMMA4_E4B',
      generateFn: jest.fn(),
      generateWithImageFn,
    });

    await expect(
      provider.generateWithVision('task', TOOLS, '/tmp/screen.png'),
    ).rejects.toThrow('vision inference failed');
  });
});

// ---------------------------------------------------------------------------
// Path normalisation (via generateWithVision)
// ---------------------------------------------------------------------------

describe('GemmaProvider path normalisation', () => {
  const makeProvider = (generateWithImageFn: jest.Mock) =>
    new GemmaProvider({
      model: 'GEMMA4_E4B',
      generateFn: jest.fn(),
      generateWithImageFn,
    });

  it('strips file:// prefix', async () => {
    const fn = jest.fn().mockResolvedValue('ok');
    await makeProvider(fn).generateWithVision('t', TOOLS, 'file:///sdcard/screenshot.png');
    expect(fn.mock.calls[0][1]).toBe('/sdcard/screenshot.png');
  });

  it('leaves plain paths unchanged', async () => {
    const fn = jest.fn().mockResolvedValue('ok');
    await makeProvider(fn).generateWithVision('t', TOOLS, '/data/local/tmp/screen.png');
    expect(fn.mock.calls[0][1]).toBe('/data/local/tmp/screen.png');
  });
});
