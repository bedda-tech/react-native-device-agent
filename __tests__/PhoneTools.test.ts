import { PHONE_TOOLS, PHONE_TOOL_PRESETS } from '../src/tools/PhoneTools';
import type { Tool } from '../src/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getTool(name: string): Tool {
  const tool = PHONE_TOOLS.find((t) => t.name === name);
  if (!tool) throw new Error(`Tool "${name}" not found in PHONE_TOOLS`);
  return tool;
}

// ---------------------------------------------------------------------------
// Schema structure
// ---------------------------------------------------------------------------

describe('PHONE_TOOLS', () => {
  test('exports a non-empty array', () => {
    expect(Array.isArray(PHONE_TOOLS)).toBe(true);
    expect(PHONE_TOOLS.length).toBeGreaterThan(0);
  });

  test('every tool has name, description, and parameters', () => {
    for (const tool of PHONE_TOOLS) {
      expect(typeof tool.name).toBe('string');
      expect(tool.name.length).toBeGreaterThan(0);
      expect(typeof tool.description).toBe('string');
      expect(tool.description.length).toBeGreaterThan(0);
      expect(tool.parameters.type).toBe('object');
      expect(typeof tool.parameters.properties).toBe('object');
    }
  });

  test('tool names are unique', () => {
    const names = PHONE_TOOLS.map((t) => t.name);
    const unique = new Set(names);
    expect(unique.size).toBe(names.length);
  });

  test('includes all expected tools', () => {
    const expected = [
      'tap',
      'long_press',
      'type_text',
      'swipe',
      'scroll',
      'open_app',
      'read_screen',
      'screenshot',
      'global_action',
      'wait',
      'find_node',
      'find_all_nodes',
      'list_apps',
      'task_complete',
      'task_failed',
    ];
    for (const name of expected) {
      expect(PHONE_TOOLS.some((t) => t.name === name)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// Individual tool schemas
// ---------------------------------------------------------------------------

describe('tap tool', () => {
  test('has nodeId, x, y properties — all optional', () => {
    const tool = getTool('tap');
    expect(tool.parameters.properties.nodeId?.type).toBe('string');
    expect(tool.parameters.properties.x?.type).toBe('number');
    expect(tool.parameters.properties.y?.type).toBe('number');
    expect(tool.parameters.required).toBeUndefined();
  });
});

describe('long_press tool', () => {
  test('has nodeId, x, y properties — all optional', () => {
    const tool = getTool('long_press');
    expect(tool.parameters.properties.nodeId?.type).toBe('string');
    expect(tool.parameters.properties.x?.type).toBe('number');
    expect(tool.parameters.properties.y?.type).toBe('number');
    expect(tool.parameters.required).toBeUndefined();
  });
});

describe('type_text tool', () => {
  test('requires text', () => {
    const tool = getTool('type_text');
    expect(tool.parameters.required).toContain('text');
    expect(tool.parameters.properties.text?.type).toBe('string');
  });
});

describe('swipe tool', () => {
  test('requires startX, startY, endX, endY', () => {
    const tool = getTool('swipe');
    const req = tool.parameters.required ?? [];
    expect(req).toContain('startX');
    expect(req).toContain('startY');
    expect(req).toContain('endX');
    expect(req).toContain('endY');
  });

  test('has optional durationMs', () => {
    const tool = getTool('swipe');
    expect(tool.parameters.properties.durationMs?.type).toBe('number');
    expect((tool.parameters.required ?? [])).not.toContain('durationMs');
  });
});

describe('scroll tool', () => {
  test('requires nodeId and direction', () => {
    const tool = getTool('scroll');
    expect(tool.parameters.required).toContain('nodeId');
    expect(tool.parameters.required).toContain('direction');
  });

  test('direction is an enum of up/down/left/right', () => {
    const tool = getTool('scroll');
    const dir = tool.parameters.properties.direction;
    expect(dir?.enum).toEqual(expect.arrayContaining(['up', 'down', 'left', 'right']));
  });
});

describe('global_action tool', () => {
  test('requires action and has correct enum values', () => {
    const tool = getTool('global_action');
    expect(tool.parameters.required).toContain('action');
    const actionEnum = tool.parameters.properties.action?.enum ?? [];
    expect(actionEnum).toContain('home');
    expect(actionEnum).toContain('back');
    expect(actionEnum).toContain('recents');
    expect(actionEnum).toContain('notifications');
  });
});

describe('task_complete tool', () => {
  test('requires summary', () => {
    const tool = getTool('task_complete');
    expect(tool.parameters.required).toContain('summary');
    expect(tool.parameters.properties.summary?.type).toBe('string');
  });
});

describe('open_app tool', () => {
  test('requires packageName', () => {
    const tool = getTool('open_app');
    expect(tool.parameters.required).toContain('packageName');
    expect(tool.parameters.properties.packageName?.type).toBe('string');
  });
});

describe('read_screen and screenshot tools', () => {
  test('read_screen has no required parameters', () => {
    const tool = getTool('read_screen');
    expect(tool.parameters.required ?? []).toHaveLength(0);
  });

  test('screenshot has no required parameters', () => {
    const tool = getTool('screenshot');
    expect(tool.parameters.required ?? []).toHaveLength(0);
  });
});

describe('list_apps tool', () => {
  test('has no required parameters', () => {
    const tool = getTool('list_apps');
    expect(tool.parameters.required ?? []).toHaveLength(0);
    expect(Object.keys(tool.parameters.properties)).toHaveLength(0);
  });
});

describe('find_node tool', () => {
  test('has text, contentDescription, and className — all optional', () => {
    const tool = getTool('find_node');
    expect(tool.parameters.properties.text?.type).toBe('string');
    expect(tool.parameters.properties.contentDescription?.type).toBe('string');
    expect(tool.parameters.properties.className?.type).toBe('string');
    expect(tool.parameters.required).toBeUndefined();
  });
});

describe('find_all_nodes tool', () => {
  test('has text, contentDescription, and className — all optional', () => {
    const tool = getTool('find_all_nodes');
    expect(tool.parameters.properties.text?.type).toBe('string');
    expect(tool.parameters.properties.contentDescription?.type).toBe('string');
    expect(tool.parameters.properties.className?.type).toBe('string');
    expect(tool.parameters.required).toBeUndefined();
  });
});

describe('task_failed tool', () => {
  test('requires reason', () => {
    const tool = getTool('task_failed');
    expect(tool.parameters.required).toContain('reason');
    expect(tool.parameters.properties.reason?.type).toBe('string');
  });
});

// ---------------------------------------------------------------------------
// PHONE_TOOL_PRESETS
// ---------------------------------------------------------------------------

describe('PHONE_TOOL_PRESETS', () => {
  const allToolNames = PHONE_TOOLS.map((t) => t.name);

  test('FULL is undefined (signals use all tools)', () => {
    expect(PHONE_TOOL_PRESETS.FULL).toBeUndefined();
  });

  test('READ_ONLY contains read_screen, screenshot, and list_apps but no actions', () => {
    const preset = PHONE_TOOL_PRESETS.READ_ONLY;
    expect(preset).toContain('read_screen');
    expect(preset).toContain('screenshot');
    expect(preset).toContain('list_apps');
    expect(preset).not.toContain('tap');
    expect(preset).not.toContain('swipe');
  });

  test('NAVIGATION does not contain type_text', () => {
    expect(PHONE_TOOL_PRESETS.NAVIGATION).not.toContain('type_text');
  });

  test('TEXT_INPUT does not contain swipe or global_action', () => {
    const preset = PHONE_TOOL_PRESETS.TEXT_INPUT;
    expect(preset).not.toContain('swipe');
    expect(preset).not.toContain('global_action');
    expect(preset).not.toContain('open_app');
  });

  test('IN_APP does not contain open_app or global_action', () => {
    const preset = PHONE_TOOL_PRESETS.IN_APP;
    expect(preset).not.toContain('open_app');
    expect(preset).not.toContain('global_action');
  });

  test('all preset tool names exist in PHONE_TOOLS', () => {
    const presets = [
      PHONE_TOOL_PRESETS.READ_ONLY,
      PHONE_TOOL_PRESETS.NAVIGATION,
      PHONE_TOOL_PRESETS.TEXT_INPUT,
      PHONE_TOOL_PRESETS.IN_APP,
    ];
    for (const preset of presets) {
      for (const name of preset) {
        expect(allToolNames).toContain(name);
      }
    }
  });
});
