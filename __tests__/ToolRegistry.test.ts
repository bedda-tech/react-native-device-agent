import { ToolRegistry } from '../src/tools/ToolRegistry';
import type { Tool, ToolCall } from '../src/types';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const tapTool: Tool = {
  name: 'tap',
  description: 'Tap a UI element',
  parameters: {
    type: 'object',
    properties: {
      nodeId: { type: 'string' },
    },
    required: ['nodeId'],
  },
};

const typeTool: Tool = {
  name: 'type_text',
  description: 'Type text into a field',
  parameters: {
    type: 'object',
    properties: {
      text: { type: 'string' },
    },
    required: ['text'],
  },
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ToolRegistry', () => {
  let registry: ToolRegistry;

  beforeEach(() => {
    registry = new ToolRegistry();
  });

  describe('register and getTools', () => {
    it('returns an empty array when no tools are registered', () => {
      expect(registry.getTools()).toEqual([]);
    });

    it('returns a registered tool in getTools()', () => {
      registry.register(tapTool, async () => true);

      const tools = registry.getTools();
      expect(tools).toHaveLength(1);
      expect(tools[0].name).toBe('tap');
    });

    it('returns all registered tools', () => {
      registry.register(tapTool, async () => true);
      registry.register(typeTool, async () => true);

      const tools = registry.getTools();
      expect(tools).toHaveLength(2);
      expect(tools.map((t) => t.name).sort()).toEqual(['tap', 'type_text']);
    });

    it('overwrites an existing tool when re-registered with the same name', () => {
      registry.register(tapTool, async () => 'first');
      registry.register({ ...tapTool, description: 'updated' }, async () => 'second');

      const tools = registry.getTools();
      expect(tools).toHaveLength(1);
      expect(tools[0].description).toBe('updated');
    });
  });

  describe('has()', () => {
    it('returns false for an unregistered tool', () => {
      expect(registry.has('nonexistent')).toBe(false);
    });

    it('returns true after registering a tool', () => {
      registry.register(tapTool, async () => true);
      expect(registry.has('tap')).toBe(true);
    });

    it('returns false for a different name than what was registered', () => {
      registry.register(tapTool, async () => true);
      expect(registry.has('swipe')).toBe(false);
    });
  });

  describe('execute()', () => {
    it('calls the registered handler with the correct args', async () => {
      const handler = jest.fn().mockResolvedValue(true);
      registry.register(tapTool, handler);

      const call: ToolCall = { name: 'tap', arguments: { nodeId: 'btn-42' } };
      await registry.execute(call);

      expect(handler).toHaveBeenCalledWith({ nodeId: 'btn-42' });
    });

    it('returns the value produced by the handler', async () => {
      registry.register(tapTool, async () => 'result-value');

      const call: ToolCall = { name: 'tap', arguments: {} };
      const result = await registry.execute(call);

      expect(result).toBe('result-value');
    });

    it('throws when the tool is not registered', async () => {
      const call: ToolCall = { name: 'unknown', arguments: {} };

      await expect(registry.execute(call)).rejects.toThrow(
        'No handler registered for tool "unknown"',
      );
    });

    it('throws with the list of available tools in the error message', async () => {
      registry.register(tapTool, async () => true);
      registry.register(typeTool, async () => true);

      const call: ToolCall = { name: 'missing', arguments: {} };

      await expect(registry.execute(call)).rejects.toThrow(/tap|type_text/);
    });

    it('propagates errors thrown by the handler', async () => {
      registry.register(tapTool, async () => {
        throw new Error('hardware error');
      });

      const call: ToolCall = { name: 'tap', arguments: { nodeId: 'x' } };

      await expect(registry.execute(call)).rejects.toThrow('hardware error');
    });

    it('executes the correct handler when multiple tools are registered', async () => {
      const tapHandler = jest.fn().mockResolvedValue('tapped');
      const typeHandler = jest.fn().mockResolvedValue('typed');

      registry.register(tapTool, tapHandler);
      registry.register(typeTool, typeHandler);

      await registry.execute({ name: 'type_text', arguments: { text: 'hello' } });

      expect(typeHandler).toHaveBeenCalledWith({ text: 'hello' });
      expect(tapHandler).not.toHaveBeenCalled();
    });
  });
});
