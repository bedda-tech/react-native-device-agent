import { ToolBuilder } from '../src/tools/ToolBuilder';
import type { Tool } from '../src/types';

// ---------------------------------------------------------------------------
// build() basics
// ---------------------------------------------------------------------------

describe('ToolBuilder.build()', () => {
  test('produces a valid Tool with name and description', () => {
    const tool: Tool = new ToolBuilder('my_tool').describe('Does something').build();
    expect(tool.name).toBe('my_tool');
    expect(tool.description).toBe('Does something');
  });

  test('parameters type is always "object"', () => {
    const tool = new ToolBuilder('t').describe('d').build();
    expect(tool.parameters.type).toBe('object');
  });

  test('throws if description is missing', () => {
    expect(() => new ToolBuilder('no_desc').build()).toThrow(
      'requires a description before build()',
    );
  });

  test('throws and mentions the tool name in the error', () => {
    expect(() => new ToolBuilder('my_unnamed_tool').build()).toThrow('my_unnamed_tool');
  });

  test('omits required field when no required params', () => {
    const tool = new ToolBuilder('t')
      .describe('d')
      .string('opt', 'optional field')
      .build();
    expect(tool.parameters.required).toBeUndefined();
  });

  test('includes required array when at least one param is required', () => {
    const tool = new ToolBuilder('t')
      .describe('d')
      .string('id', 'some id', { required: true })
      .build();
    expect(tool.parameters.required).toEqual(['id']);
  });
});

// ---------------------------------------------------------------------------
// Typed parameter helpers
// ---------------------------------------------------------------------------

describe('string()', () => {
  test('adds a string property', () => {
    const tool = new ToolBuilder('t').describe('d').string('name', 'A name').build();
    expect(tool.parameters.properties.name).toMatchObject({ type: 'string', description: 'A name' });
  });

  test('marks as required when required: true', () => {
    const tool = new ToolBuilder('t').describe('d').string('id', 'ID', { required: true }).build();
    expect(tool.parameters.required).toContain('id');
  });

  test('attaches enum values when provided', () => {
    const tool = new ToolBuilder('t')
      .describe('d')
      .string('dir', 'Direction', { enum: ['up', 'down'] })
      .build();
    expect(tool.parameters.properties.dir.enum).toEqual(['up', 'down']);
  });

  test('does not add enum key when not provided', () => {
    const tool = new ToolBuilder('t').describe('d').string('name', 'A name').build();
    expect(tool.parameters.properties.name.enum).toBeUndefined();
  });
});

describe('number()', () => {
  test('adds a number property', () => {
    const tool = new ToolBuilder('t').describe('d').number('x', 'X coord').build();
    expect(tool.parameters.properties.x).toMatchObject({ type: 'number', description: 'X coord' });
  });

  test('marks as required when required: true', () => {
    const tool = new ToolBuilder('t').describe('d').number('x', 'X', { required: true }).build();
    expect(tool.parameters.required).toContain('x');
  });
});

describe('boolean()', () => {
  test('adds a boolean property', () => {
    const tool = new ToolBuilder('t').describe('d').boolean('active', 'Is active').build();
    expect(tool.parameters.properties.active).toMatchObject({ type: 'boolean' });
  });
});

describe('object()', () => {
  test('adds an object property', () => {
    const tool = new ToolBuilder('t').describe('d').object('meta', 'Metadata').build();
    expect(tool.parameters.properties.meta.type).toBe('object');
  });
});

describe('array()', () => {
  test('adds an array property', () => {
    const tool = new ToolBuilder('t').describe('d').array('tags', 'Tags list').build();
    expect(tool.parameters.properties.tags.type).toBe('array');
  });
});

describe('param()', () => {
  test('adds a property with explicit type', () => {
    const tool = new ToolBuilder('t').describe('d').param('count', 'number', 'Count').build();
    expect(tool.parameters.properties.count).toMatchObject({ type: 'number', description: 'Count' });
  });

  test('attaches enum values when provided', () => {
    const tool = new ToolBuilder('t')
      .describe('d')
      .param('color', 'string', 'Color', { enum: ['red', 'blue'] })
      .build();
    expect(tool.parameters.properties.color.enum).toEqual(['red', 'blue']);
  });

  test('marks as required when required: true', () => {
    const tool = new ToolBuilder('t')
      .describe('d')
      .param('key', 'string', 'Key', { required: true })
      .build();
    expect(tool.parameters.required).toContain('key');
  });
});

// ---------------------------------------------------------------------------
// Chaining and multiple params
// ---------------------------------------------------------------------------

describe('method chaining', () => {
  test('all methods return `this` for chaining', () => {
    const builder = new ToolBuilder('t');
    expect(builder.describe('d')).toBe(builder);
    expect(builder.string('a', 'A')).toBe(builder);
    expect(builder.number('b', 'B')).toBe(builder);
    expect(builder.boolean('c', 'C')).toBe(builder);
    expect(builder.object('d', 'D')).toBe(builder);
    expect(builder.array('e', 'E')).toBe(builder);
    expect(builder.param('f', 'string', 'F')).toBe(builder);
  });

  test('builds a tool with multiple params and multiple required', () => {
    const tool = new ToolBuilder('copy_text')
      .describe('Copy text between fields')
      .string('sourceNodeId', 'Source node', { required: true })
      .string('targetNodeId', 'Target node', { required: true })
      .boolean('clearTarget', 'Clear target first')
      .build();

    expect(tool.name).toBe('copy_text');
    expect(Object.keys(tool.parameters.properties)).toHaveLength(3);
    expect(tool.parameters.required).toEqual(['sourceNodeId', 'targetNodeId']);
  });

  test('build() does not mutate internal state (can call build() twice)', () => {
    const builder = new ToolBuilder('t').describe('d').string('x', 'X', { required: true });
    const t1 = builder.build();
    const t2 = builder.build();
    expect(t1).toEqual(t2);
    expect(t1.parameters.required).toEqual(['x']);
  });
});
