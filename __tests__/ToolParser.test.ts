import { ToolParser } from '../src/agent/ToolParser';

describe('ToolParser.parse', () => {
  describe('XML tag format', () => {
    it('parses a single tool_call tag', () => {
      const input = '<tool_call>{"name": "tap", "arguments": {"nodeId": "42"}}</tool_call>';
      const result = ToolParser.parse(input);
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({ name: 'tap', arguments: { nodeId: '42' } });
    });

    it('parses multiple tool_call tags', () => {
      const input = [
        '<tool_call>{"name": "tap", "arguments": {"nodeId": "1"}}</tool_call>',
        '<tool_call>{"name": "swipe", "arguments": {"startX": 0, "startY": 0}}</tool_call>',
      ].join('\n');
      const result = ToolParser.parse(input);
      expect(result).toHaveLength(2);
      expect(result[0].name).toBe('tap');
      expect(result[1].name).toBe('swipe');
    });

    it('accepts "tool" as an alias for "name"', () => {
      const input = '<tool_call>{"tool": "open_app", "arguments": {"package": "com.example"}}</tool_call>';
      const result = ToolParser.parse(input);
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('open_app');
    });

    it('accepts "args" as an alias for "arguments"', () => {
      const input = '<tool_call>{"name": "wait", "args": {"ms": 500}}</tool_call>';
      const result = ToolParser.parse(input);
      expect(result).toHaveLength(1);
      expect(result[0].arguments).toEqual({ ms: 500 });
    });

    it('skips malformed XML tag content', () => {
      const input = '<tool_call>NOT JSON</tool_call>';
      const result = ToolParser.parse(input);
      expect(result).toHaveLength(0);
    });
  });

  describe('markdown code block format', () => {
    it('parses a ```json code block', () => {
      const input = '```json\n{"name": "type_text", "arguments": {"text": "hello"}}\n```';
      const result = ToolParser.parse(input);
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({ name: 'type_text', arguments: { text: 'hello' } });
    });

    it('parses a plain ``` code block', () => {
      const input = '```\n{"name": "global_action", "arguments": {"action": "back"}}\n```';
      const result = ToolParser.parse(input);
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('global_action');
    });

    it('parses an array of tool calls in a code block', () => {
      const input = '```json\n[{"name":"tap","arguments":{"nodeId":"1"}},{"name":"wait","arguments":{"ms":300}}]\n```';
      const result = ToolParser.parse(input);
      expect(result).toHaveLength(2);
      expect(result[0].name).toBe('tap');
      expect(result[1].name).toBe('wait');
    });
  });

  describe('bare JSON format', () => {
    it('parses a bare JSON object', () => {
      const input = 'I will tap the button. {"name": "tap", "arguments": {"nodeId": "99"}}';
      const result = ToolParser.parse(input);
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('tap');
    });

    it('parses a bare JSON array', () => {
      const input = '[{"name":"tap","arguments":{"nodeId":"5"}},{"name":"task_complete","arguments":{"summary":"done"}}]';
      const result = ToolParser.parse(input);
      expect(result).toHaveLength(2);
      expect(result[1].name).toBe('task_complete');
    });
  });

  describe('edge cases', () => {
    it('returns empty array for empty input', () => {
      expect(ToolParser.parse('')).toEqual([]);
    });

    it('returns empty array for non-string input', () => {
      expect(ToolParser.parse(null as unknown as string)).toEqual([]);
    });

    it('returns empty array when no tool calls found', () => {
      expect(ToolParser.parse('Just some plain text with no JSON.')).toEqual([]);
    });

    it('ignores JSON objects without a name field', () => {
      const input = '{"foo": "bar", "arguments": {}}';
      expect(ToolParser.parse(input)).toEqual([]);
    });

    it('XML tags take priority over code blocks', () => {
      const input = [
        '<tool_call>{"name": "xml_tool", "arguments": {}}</tool_call>',
        '```json\n{"name": "code_tool", "arguments": {}}\n```',
      ].join('\n');
      const result = ToolParser.parse(input);
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('xml_tool');
    });
  });
});

describe('ToolParser.validate', () => {
  const baseCall = { name: 'tap', arguments: { nodeId: '1' } };

  it('returns true for a valid call with no schema', () => {
    expect(ToolParser.validate(baseCall, null)).toBe(true);
  });

  it('returns true when all required params are present', () => {
    const schema = { required: ['nodeId'], properties: { nodeId: { type: 'string' } } };
    expect(ToolParser.validate(baseCall, schema)).toBe(true);
  });

  it('returns false when a required param is missing', () => {
    const schema = { required: ['nodeId', 'action'] };
    expect(ToolParser.validate(baseCall, schema)).toBe(false);
  });

  it('returns false for a call with no name', () => {
    const call = { name: '', arguments: {} };
    expect(ToolParser.validate(call, null)).toBe(false);
  });

  it('returns false for a call with non-object arguments', () => {
    const call = { name: 'tap', arguments: null as unknown as Record<string, unknown> };
    expect(ToolParser.validate(call, null)).toBe(false);
  });
});
