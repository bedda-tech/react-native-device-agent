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
      'clear_text',
      'press_enter',
      'swipe',
      'scroll',
      'open_app',
      'read_screen',
      'screenshot',
      'global_action',
      'wait',
      'find_node',
      'find_all_nodes',
      'wait_for_node',
      'wait_for_change',
      'get_node_text',
      'get_bounds',
      'set_checked',
      'list_apps',
      'task_complete',
      'task_failed',
      'write_note',
      'read_note',
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
  test('requires direction; nodeId is optional (auto-detects scrollable)', () => {
    const tool = getTool('scroll');
    expect(tool.parameters.required).toContain('direction');
    expect(tool.parameters.properties.nodeId?.type).toBe('string');
    expect((tool.parameters.required ?? [])).not.toContain('nodeId');
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
  test('has text, contentDescription, className, isChecked, isEnabled — all optional', () => {
    const tool = getTool('find_node');
    expect(tool.parameters.properties.text?.type).toBe('string');
    expect(tool.parameters.properties.contentDescription?.type).toBe('string');
    expect(tool.parameters.properties.className?.type).toBe('string');
    expect(tool.parameters.properties.isChecked?.type).toBe('boolean');
    expect(tool.parameters.properties.isEnabled?.type).toBe('boolean');
    expect(tool.parameters.required).toBeUndefined();
  });
});

describe('find_all_nodes tool', () => {
  test('has text, contentDescription, className, isChecked, isEnabled — all optional', () => {
    const tool = getTool('find_all_nodes');
    expect(tool.parameters.properties.text?.type).toBe('string');
    expect(tool.parameters.properties.contentDescription?.type).toBe('string');
    expect(tool.parameters.properties.className?.type).toBe('string');
    expect(tool.parameters.properties.isChecked?.type).toBe('boolean');
    expect(tool.parameters.properties.isEnabled?.type).toBe('boolean');
    expect(tool.parameters.required).toBeUndefined();
  });
});

describe('wait_for_node tool', () => {
  test('has text, contentDescription, className, isChecked, isEnabled, timeoutMs, intervalMs — all optional', () => {
    const tool = getTool('wait_for_node');
    expect(tool.parameters.properties.text?.type).toBe('string');
    expect(tool.parameters.properties.contentDescription?.type).toBe('string');
    expect(tool.parameters.properties.className?.type).toBe('string');
    expect(tool.parameters.properties.isChecked?.type).toBe('boolean');
    expect(tool.parameters.properties.isEnabled?.type).toBe('boolean');
    expect(tool.parameters.properties.timeoutMs?.type).toBe('number');
    expect(tool.parameters.properties.intervalMs?.type).toBe('number');
    expect(tool.parameters.required).toBeUndefined();
  });
});

describe('wait_for_change tool', () => {
  test('has timeoutMs and pollIntervalMs — both optional', () => {
    const tool = getTool('wait_for_change');
    expect(tool.parameters.properties.timeoutMs?.type).toBe('number');
    expect(tool.parameters.properties.pollIntervalMs?.type).toBe('number');
    expect(tool.parameters.required).toBeUndefined();
  });
});

describe('get_node_text tool', () => {
  test('requires nodeId', () => {
    const tool = getTool('get_node_text');
    expect(tool.parameters.required).toContain('nodeId');
    expect(tool.parameters.properties.nodeId?.type).toBe('string');
  });
});

describe('task_failed tool', () => {
  test('requires reason', () => {
    const tool = getTool('task_failed');
    expect(tool.parameters.required).toContain('reason');
    expect(tool.parameters.properties.reason?.type).toBe('string');
  });
});

describe('clear_text tool', () => {
  test('has optional nodeId only — no required params', () => {
    const tool = getTool('clear_text');
    expect(tool.parameters.properties.nodeId?.type).toBe('string');
    expect(tool.parameters.required ?? []).toHaveLength(0);
  });
});

describe('press_enter tool', () => {
  test('has optional nodeId only — no required params', () => {
    const tool = getTool('press_enter');
    expect(tool.parameters.properties.nodeId?.type).toBe('string');
    expect(tool.parameters.required ?? []).toHaveLength(0);
  });
});

describe('get_bounds tool', () => {
  test('requires nodeId', () => {
    const tool = getTool('get_bounds');
    expect(tool.parameters.properties.nodeId?.type).toBe('string');
    expect(tool.parameters.required).toContain('nodeId');
  });
});

describe('set_checked tool', () => {
  test('requires nodeId and checked', () => {
    const tool = getTool('set_checked');
    expect(tool.parameters.properties.nodeId?.type).toBe('string');
    expect(tool.parameters.properties.checked?.type).toBe('boolean');
    expect(tool.parameters.required).toContain('nodeId');
    expect(tool.parameters.required).toContain('checked');
  });
});

describe('write_note tool', () => {
  test('requires key and value', () => {
    const tool = getTool('write_note');
    expect(tool.parameters.properties.key?.type).toBe('string');
    expect(tool.parameters.properties.value?.type).toBe('string');
    expect(tool.parameters.required).toContain('key');
    expect(tool.parameters.required).toContain('value');
  });
});

describe('read_note tool', () => {
  test('requires key', () => {
    const tool = getTool('read_note');
    expect(tool.parameters.properties.key?.type).toBe('string');
    expect(tool.parameters.required).toContain('key');
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

  test('TEXT_INPUT contains clear_text and press_enter but not swipe or global_action', () => {
    const preset = PHONE_TOOL_PRESETS.TEXT_INPUT;
    expect(preset).toContain('clear_text');
    expect(preset).toContain('press_enter');
    expect(preset).not.toContain('swipe');
    expect(preset).not.toContain('global_action');
    expect(preset).not.toContain('open_app');
  });

  test('IN_APP contains clear_text and press_enter', () => {
    const preset = PHONE_TOOL_PRESETS.IN_APP;
    expect(preset).toContain('clear_text');
    expect(preset).toContain('press_enter');
  });

  test('IN_APP does not contain open_app or global_action', () => {
    const preset = PHONE_TOOL_PRESETS.IN_APP;
    expect(preset).not.toContain('open_app');
    expect(preset).not.toContain('global_action');
  });

  test('wait_for_change is in NAVIGATION, TEXT_INPUT, IN_APP but not READ_ONLY', () => {
    expect(PHONE_TOOL_PRESETS.NAVIGATION).toContain('wait_for_change');
    expect(PHONE_TOOL_PRESETS.TEXT_INPUT).toContain('wait_for_change');
    expect(PHONE_TOOL_PRESETS.IN_APP).toContain('wait_for_change');
    expect(PHONE_TOOL_PRESETS.READ_ONLY).not.toContain('wait_for_change');
  });

  test('write_note and read_note are available in all named presets', () => {
    const namedPresets = [
      PHONE_TOOL_PRESETS.READ_ONLY,
      PHONE_TOOL_PRESETS.NAVIGATION,
      PHONE_TOOL_PRESETS.TEXT_INPUT,
      PHONE_TOOL_PRESETS.IN_APP,
    ];
    for (const preset of namedPresets) {
      expect(preset).toContain('write_note');
      expect(preset).toContain('read_note');
    }
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
