import { CloudProvider } from '../src/providers/CloudProvider';
import type { Tool } from '../src/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SAMPLE_TOOL: Tool = {
  name: 'tap',
  description: 'Tap a UI element',
  parameters: {
    type: 'object',
    properties: {
      nodeId: { type: 'string', description: 'Node ID to tap' },
    },
    required: ['nodeId'],
  },
};

function makeFetchMock(responseBody: unknown, status = 200) {
  return jest.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    json: () => Promise.resolve(responseBody),
    text: () => Promise.resolve(JSON.stringify(responseBody)),
  });
}

// ---------------------------------------------------------------------------
// OpenAI format
// ---------------------------------------------------------------------------

describe('CloudProvider (OpenAI format)', () => {
  const provider = new CloudProvider({
    apiKey: 'test-openai-key',
    model: 'gpt-4o',
    baseUrl: 'https://api.openai.com/v1',
    apiFormat: 'openai',
  });

  beforeEach(() => {
    global.fetch = makeFetchMock({
      choices: [{ message: { content: 'Hello from OpenAI' } }],
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('generate() posts to /chat/completions and returns content', async () => {
    const result = await provider.generate('Say hello');
    expect(result).toBe('Hello from OpenAI');

    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [url, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(url).toContain('/chat/completions');
    expect(init.method).toBe('POST');

    const body = JSON.parse(init.body);
    expect(body.model).toBe('gpt-4o');
    expect(body.messages).toEqual([{ role: 'user', content: 'Say hello' }]);
    expect(init.headers['Authorization']).toBe('Bearer test-openai-key');
  });

  test('generateWithTools() returns text content when model replies with text', async () => {
    const result = await provider.generateWithTools('Do something', [SAMPLE_TOOL]);
    expect(result).toBe('Hello from OpenAI');

    const [url, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(url).toContain('/chat/completions');
    const body = JSON.parse(init.body);
    expect(body.tools).toBeDefined();
    expect(body.tool_choice).toBe('auto');
  });

  test('generateWithTools() serializes native tool_calls to JSON', async () => {
    global.fetch = makeFetchMock({
      choices: [
        {
          message: {
            tool_calls: [
              {
                function: {
                  name: 'tap',
                  arguments: JSON.stringify({ nodeId: 'node-42' }),
                },
              },
            ],
          },
        },
      ],
    });

    const result = await provider.generateWithTools('Tap something', [SAMPLE_TOOL]);
    const parsed = JSON.parse(result);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed[0]).toEqual({ name: 'tap', arguments: { nodeId: 'node-42' } });
  });

  test('generateWithTools() handles malformed tool_calls arguments gracefully', async () => {
    global.fetch = makeFetchMock({
      choices: [
        {
          message: {
            tool_calls: [
              { function: { name: 'tap', arguments: 'NOT_JSON' } },
            ],
          },
        },
      ],
    });

    const result = await provider.generateWithTools('Tap something', [SAMPLE_TOOL]);
    const parsed = JSON.parse(result);
    expect(parsed[0]).toEqual({ name: 'tap', arguments: {} });
  });

  test('generate() returns empty string when choices is missing', async () => {
    global.fetch = makeFetchMock({ choices: [] });
    const result = await provider.generate('prompt');
    expect(result).toBe('');
  });

  test('throws on non-2xx response', async () => {
    global.fetch = makeFetchMock({ error: 'Unauthorized' }, 401);
    await expect(provider.generate('prompt')).rejects.toThrow('CloudProvider API error 401');
  });
});

// ---------------------------------------------------------------------------
// Anthropic format
// ---------------------------------------------------------------------------

describe('CloudProvider (Anthropic format)', () => {
  const provider = new CloudProvider({
    apiKey: 'test-anthropic-key',
    model: 'claude-sonnet-4-6',
    baseUrl: 'https://api.anthropic.com/v1',
    apiFormat: 'anthropic',
  });

  beforeEach(() => {
    global.fetch = makeFetchMock({
      content: [{ type: 'text', text: 'Hello from Anthropic' }],
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('generate() posts to /messages with Anthropic headers', async () => {
    const result = await provider.generate('Say hello');
    expect(result).toBe('Hello from Anthropic');

    const [url, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(url).toContain('/messages');
    expect(init.headers['x-api-key']).toBe('test-anthropic-key');
    expect(init.headers['anthropic-version']).toBe('2023-06-01');
    expect(init.headers['Authorization']).toBeUndefined();

    const body = JSON.parse(init.body);
    expect(body.model).toBe('claude-sonnet-4-6');
    expect(body.messages).toEqual([{ role: 'user', content: 'Say hello' }]);
  });

  test('generateWithTools() returns text when model replies with text block', async () => {
    const result = await provider.generateWithTools('Do something', [SAMPLE_TOOL]);
    expect(result).toBe('Hello from Anthropic');

    const [, init] = (global.fetch as jest.Mock).mock.calls[0];
    const body = JSON.parse(init.body);
    expect(body.tools).toBeDefined();
    expect(body.tools[0].name).toBe('tap');
    expect(body.tools[0].input_schema).toBeDefined();
  });

  test('generateWithTools() serializes tool_use blocks to JSON', async () => {
    global.fetch = makeFetchMock({
      content: [
        {
          type: 'tool_use',
          name: 'tap',
          input: { nodeId: 'node-7' },
        },
      ],
    });

    const result = await provider.generateWithTools('Tap something', [SAMPLE_TOOL]);
    const parsed = JSON.parse(result);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed[0]).toEqual({ name: 'tap', arguments: { nodeId: 'node-7' } });
  });

  test('generateWithTools() handles mixed text + tool_use, returns only tool calls', async () => {
    global.fetch = makeFetchMock({
      content: [
        { type: 'text', text: 'I will tap it.' },
        { type: 'tool_use', name: 'tap', input: { nodeId: 'node-8' } },
      ],
    });

    const result = await provider.generateWithTools('Tap', [SAMPLE_TOOL]);
    const parsed = JSON.parse(result);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].name).toBe('tap');
  });

  test('generate() returns empty string when content is empty array', async () => {
    global.fetch = makeFetchMock({ content: [] });
    const result = await provider.generate('prompt');
    expect(result).toBe('');
  });

  test('throws on non-2xx response', async () => {
    global.fetch = makeFetchMock({ type: 'error', error: { message: 'Forbidden' } }, 403);
    await expect(provider.generate('prompt')).rejects.toThrow('CloudProvider API error 403');
  });
});

// ---------------------------------------------------------------------------
// OpenRouter format
// ---------------------------------------------------------------------------

describe('CloudProvider (OpenRouter format)', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('defaults to openrouter.ai/api/v1 base URL', async () => {
    const provider = new CloudProvider({
      apiKey: 'or-test-key',
      model: 'anthropic/claude-sonnet-4-6',
      apiFormat: 'openrouter',
    });
    global.fetch = makeFetchMock({
      choices: [{ message: { content: 'ok' } }],
    });

    await provider.generate('hi');
    const [url] = (global.fetch as jest.Mock).mock.calls[0];
    expect(url).toContain('openrouter.ai/api/v1');
    expect(url).toContain('/chat/completions');
  });

  test('uses Bearer auth like OpenAI', async () => {
    const provider = new CloudProvider({
      apiKey: 'or-key-123',
      model: 'anthropic/claude-sonnet-4-6',
      apiFormat: 'openrouter',
    });
    global.fetch = makeFetchMock({
      choices: [{ message: { content: 'hello' } }],
    });

    await provider.generate('test');
    const [, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(init.headers['Authorization']).toBe('Bearer or-key-123');
    expect(init.headers['x-api-key']).toBeUndefined();
  });

  test('sends HTTP-Referer header when referer is provided', async () => {
    const provider = new CloudProvider({
      apiKey: 'or-key',
      model: 'anthropic/claude-sonnet-4-6',
      apiFormat: 'openrouter',
      referer: 'https://github.com/bedda-tech/deft',
    });
    global.fetch = makeFetchMock({
      choices: [{ message: { content: 'ok' } }],
    });

    await provider.generate('test');
    const [, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(init.headers['HTTP-Referer']).toBe('https://github.com/bedda-tech/deft');
  });

  test('omits HTTP-Referer when referer is not provided', async () => {
    const provider = new CloudProvider({
      apiKey: 'or-key',
      model: 'anthropic/claude-sonnet-4-6',
      apiFormat: 'openrouter',
    });
    global.fetch = makeFetchMock({
      choices: [{ message: { content: 'ok' } }],
    });

    await provider.generate('test');
    const [, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(init.headers['HTTP-Referer']).toBeUndefined();
  });

  test('generateWithTools() serializes native tool_calls (same as OpenAI path)', async () => {
    const provider = new CloudProvider({
      apiKey: 'or-key',
      model: 'anthropic/claude-sonnet-4-6',
      apiFormat: 'openrouter',
    });
    global.fetch = makeFetchMock({
      choices: [
        {
          message: {
            tool_calls: [
              { function: { name: 'tap', arguments: JSON.stringify({ nodeId: 'n1' }) } },
            ],
          },
        },
      ],
    });

    const result = await provider.generateWithTools('tap it', [SAMPLE_TOOL]);
    const parsed = JSON.parse(result);
    expect(parsed[0]).toEqual({ name: 'tap', arguments: { nodeId: 'n1' } });
  });
});

// ---------------------------------------------------------------------------
// Default options
// ---------------------------------------------------------------------------

describe('CloudProvider default options', () => {
  test('defaults to OpenAI format and api.openai.com', async () => {
    const provider = new CloudProvider({ apiKey: 'key', model: 'gpt-4o' });
    global.fetch = makeFetchMock({
      choices: [{ message: { content: 'ok' } }],
    });

    await provider.generate('hi');
    const [url] = (global.fetch as jest.Mock).mock.calls[0];
    expect(url).toContain('api.openai.com');
    expect(url).toContain('/chat/completions');
  });
});

// ---------------------------------------------------------------------------
// System prompt injection
// ---------------------------------------------------------------------------

describe('CloudProvider system prompt', () => {
  afterEach(() => { jest.restoreAllMocks(); });

  test('OpenAI: prepends system message before user message', async () => {
    const provider = new CloudProvider({
      apiKey: 'key',
      model: 'gpt-4o',
      apiFormat: 'openai',
      system: 'You are a phone control agent.',
    });
    global.fetch = makeFetchMock({
      choices: [{ message: { content: 'ok' } }],
    });

    await provider.generate('Tap the button');
    const [, init] = (global.fetch as jest.Mock).mock.calls[0];
    const body = JSON.parse(init.body);
    expect(body.messages).toHaveLength(2);
    expect(body.messages[0]).toEqual({ role: 'system', content: 'You are a phone control agent.' });
    expect(body.messages[1]).toEqual({ role: 'user', content: 'Tap the button' });
  });

  test('OpenAI: no system message when system is unset', async () => {
    const provider = new CloudProvider({ apiKey: 'key', model: 'gpt-4o', apiFormat: 'openai' });
    global.fetch = makeFetchMock({ choices: [{ message: { content: 'ok' } }] });

    await provider.generate('hi');
    const [, init] = (global.fetch as jest.Mock).mock.calls[0];
    const body = JSON.parse(init.body);
    expect(body.messages).toHaveLength(1);
    expect(body.messages[0].role).toBe('user');
  });

  test('OpenAI: generateWithTools also prepends system message', async () => {
    const provider = new CloudProvider({
      apiKey: 'key',
      model: 'gpt-4o',
      apiFormat: 'openai',
      system: 'Agent system prompt',
    });
    global.fetch = makeFetchMock({ choices: [{ message: { content: 'ok' } }] });

    await provider.generateWithTools('Do something', [SAMPLE_TOOL]);
    const [, init] = (global.fetch as jest.Mock).mock.calls[0];
    const body = JSON.parse(init.body);
    expect(body.messages[0]).toEqual({ role: 'system', content: 'Agent system prompt' });
  });

  test('Anthropic: includes top-level system field', async () => {
    const provider = new CloudProvider({
      apiKey: 'key',
      model: 'claude-sonnet-4-6',
      baseUrl: 'https://api.anthropic.com/v1',
      apiFormat: 'anthropic',
      system: 'You control the phone.',
    });
    global.fetch = makeFetchMock({
      content: [{ type: 'text', text: 'ok' }],
    });

    await provider.generate('What is on screen?');
    const [, init] = (global.fetch as jest.Mock).mock.calls[0];
    const body = JSON.parse(init.body);
    expect(body.system).toBe('You control the phone.');
    expect(body.messages).toEqual([{ role: 'user', content: 'What is on screen?' }]);
  });

  test('Anthropic: no system field when system is unset', async () => {
    const provider = new CloudProvider({
      apiKey: 'key',
      model: 'claude-sonnet-4-6',
      baseUrl: 'https://api.anthropic.com/v1',
      apiFormat: 'anthropic',
    });
    global.fetch = makeFetchMock({ content: [{ type: 'text', text: 'ok' }] });

    await provider.generate('hi');
    const [, init] = (global.fetch as jest.Mock).mock.calls[0];
    const body = JSON.parse(init.body);
    expect(body.system).toBeUndefined();
  });

  test('Anthropic: generateWithTools also passes system field', async () => {
    const provider = new CloudProvider({
      apiKey: 'key',
      model: 'claude-sonnet-4-6',
      baseUrl: 'https://api.anthropic.com/v1',
      apiFormat: 'anthropic',
      system: 'Agent prompt',
    });
    global.fetch = makeFetchMock({ content: [{ type: 'text', text: 'ok' }] });

    await provider.generateWithTools('Do something', [SAMPLE_TOOL]);
    const [, init] = (global.fetch as jest.Mock).mock.calls[0];
    const body = JSON.parse(init.body);
    expect(body.system).toBe('Agent prompt');
  });
});
