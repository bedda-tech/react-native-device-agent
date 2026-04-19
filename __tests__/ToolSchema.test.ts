import { toOpenAIFunction, toAnthropicTool, toGemmaFunction, validateArgs } from '../src/tools/ToolSchema';
import type { Tool, ToolParameters } from '../src/types';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const TAP_TOOL: Tool = {
  name: 'tap',
  description: 'Tap a UI element',
  parameters: {
    type: 'object',
    properties: {
      nodeId: { type: 'string', description: 'Accessibility node ID' },
      x: { type: 'number', description: 'X coordinate' },
    },
    required: ['nodeId'],
  },
};

const SCROLL_TOOL: Tool = {
  name: 'scroll',
  description: 'Scroll a container',
  parameters: {
    type: 'object',
    properties: {
      direction: {
        type: 'string',
        description: 'Scroll direction',
        enum: ['up', 'down', 'left', 'right'],
      },
      nodeId: { type: 'string', description: 'Container node' },
    },
    required: ['direction', 'nodeId'],
  },
};

const NO_REQUIRED_TOOL: Tool = {
  name: 'read_screen',
  description: 'Read the current screen',
  parameters: { type: 'object', properties: {} },
};

// ---------------------------------------------------------------------------
// toOpenAIFunction
// ---------------------------------------------------------------------------

describe('toOpenAIFunction', () => {
  test('wraps schema in function + type envelope', () => {
    const result = toOpenAIFunction(TAP_TOOL);
    expect(result.type).toBe('function');
    expect(result.function).toBeDefined();
  });

  test('preserves name and description', () => {
    const fn = (toOpenAIFunction(TAP_TOOL) as Record<string, Record<string, unknown>>).function;
    expect(fn.name).toBe('tap');
    expect(fn.description).toBe('Tap a UI element');
  });

  test('includes required array (defaults to [] when undefined)', () => {
    const noReq = toOpenAIFunction(NO_REQUIRED_TOOL);
    const params = (noReq as Record<string, Record<string, unknown>>).function.parameters as Record<string, unknown>;
    expect(params.required).toEqual([]);
  });

  test('includes required array from schema', () => {
    const fn = (toOpenAIFunction(TAP_TOOL) as Record<string, Record<string, unknown>>).function;
    const params = fn.parameters as Record<string, unknown>;
    expect(params.required).toEqual(['nodeId']);
  });

  test('serializes property descriptions', () => {
    const fn = (toOpenAIFunction(TAP_TOOL) as Record<string, Record<string, unknown>>).function;
    const props = (fn.parameters as Record<string, unknown>).properties as Record<string, Record<string, unknown>>;
    expect(props.nodeId?.description).toBe('Accessibility node ID');
    expect(props.nodeId?.type).toBe('string');
  });

  test('serializes enum values', () => {
    const fn = (toOpenAIFunction(SCROLL_TOOL) as Record<string, Record<string, unknown>>).function;
    const props = (fn.parameters as Record<string, unknown>).properties as Record<string, Record<string, unknown>>;
    expect(props.direction?.enum).toEqual(['up', 'down', 'left', 'right']);
  });
});

// ---------------------------------------------------------------------------
// toAnthropicTool
// ---------------------------------------------------------------------------

describe('toAnthropicTool', () => {
  test('uses input_schema instead of parameters', () => {
    const result = toAnthropicTool(TAP_TOOL) as Record<string, unknown>;
    expect(result.input_schema).toBeDefined();
    expect((result as Record<string, unknown>).parameters).toBeUndefined();
  });

  test('preserves name and description at top level', () => {
    const result = toAnthropicTool(TAP_TOOL) as Record<string, unknown>;
    expect(result.name).toBe('tap');
    expect(result.description).toBe('Tap a UI element');
  });

  test('includes required array from schema', () => {
    const result = toAnthropicTool(TAP_TOOL) as Record<string, unknown>;
    const schema = result.input_schema as Record<string, unknown>;
    expect(schema.required).toEqual(['nodeId']);
  });

  test('defaults required to [] when undefined', () => {
    const result = toAnthropicTool(NO_REQUIRED_TOOL) as Record<string, unknown>;
    const schema = result.input_schema as Record<string, unknown>;
    expect(schema.required).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// toGemmaFunction
// ---------------------------------------------------------------------------

describe('toGemmaFunction', () => {
  test('does not have outer type/function wrapper', () => {
    const result = toGemmaFunction(TAP_TOOL) as Record<string, unknown>;
    expect(result.type).toBeUndefined();
    expect(result.function).toBeUndefined();
  });

  test('preserves name and description at top level', () => {
    const result = toGemmaFunction(TAP_TOOL) as Record<string, unknown>;
    expect(result.name).toBe('tap');
    expect(result.description).toBe('Tap a UI element');
  });

  test('has parameters key with properties', () => {
    const result = toGemmaFunction(TAP_TOOL) as Record<string, unknown>;
    const params = result.parameters as Record<string, unknown>;
    expect(params).toBeDefined();
    expect(params.type).toBe('object');
  });
});

// ---------------------------------------------------------------------------
// validateArgs
// ---------------------------------------------------------------------------

describe('validateArgs', () => {
  const params: ToolParameters = {
    type: 'object',
    properties: {
      nodeId: { type: 'string' },
      x: { type: 'number' },
      active: { type: 'boolean' },
      meta: { type: 'object' },
      tags: { type: 'array' },
      direction: { type: 'string', enum: ['up', 'down'] },
    },
    required: ['nodeId'],
  };

  test('returns valid when all required args present with correct types', () => {
    const result = validateArgs({ nodeId: 'abc' }, params);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  test('reports missing required arg', () => {
    const result = validateArgs({}, params);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('nodeId'))).toBe(true);
  });

  test('reports wrong type for string', () => {
    const result = validateArgs({ nodeId: 123 }, params);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('nodeId') && e.includes('string'))).toBe(true);
  });

  test('reports wrong type for number', () => {
    const result = validateArgs({ nodeId: 'id', x: 'not-a-number' }, params);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('x') && e.includes('number'))).toBe(true);
  });

  test('reports wrong type for boolean', () => {
    const result = validateArgs({ nodeId: 'id', active: 'true' }, params);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('active'))).toBe(true);
  });

  test('reports wrong type for object', () => {
    const result = validateArgs({ nodeId: 'id', meta: [1, 2, 3] }, params);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('meta'))).toBe(true);
  });

  test('reports wrong type for array', () => {
    const result = validateArgs({ nodeId: 'id', tags: 'not-array' }, params);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('tags'))).toBe(true);
  });

  test('accepts a valid array', () => {
    const result = validateArgs({ nodeId: 'id', tags: ['a', 'b'] }, params);
    expect(result.valid).toBe(true);
  });

  test('reports enum violation', () => {
    const result = validateArgs({ nodeId: 'id', direction: 'left' }, params);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('direction'))).toBe(true);
  });

  test('accepts valid enum value', () => {
    const result = validateArgs({ nodeId: 'id', direction: 'up' }, params);
    expect(result.valid).toBe(true);
  });

  test('tolerates unknown args without errors', () => {
    const result = validateArgs({ nodeId: 'id', unknownProp: 42 }, params);
    expect(result.valid).toBe(true);
  });

  test('treats null as missing for required fields', () => {
    const result = validateArgs({ nodeId: null }, params);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('nodeId'))).toBe(true);
  });

  test('handles schema with no required fields', () => {
    const noRequired: ToolParameters = {
      type: 'object',
      properties: { name: { type: 'string' } },
    };
    const result = validateArgs({}, noRequired);
    expect(result.valid).toBe(true);
  });
});
