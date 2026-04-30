import type { Tool } from '../types';

/**
 * Default tool set for phone control.
 *
 * These tools map directly to react-native-accessibility-controller APIs
 * and are provided to the LLM so it can decide which actions to take.
 */
export const PHONE_TOOLS: Tool[] = [
  {
    name: 'tap',
    description: 'Tap a UI element by its node ID or screen coordinates',
    parameters: {
      type: 'object',
      properties: {
        nodeId: { type: 'string', description: 'Accessibility node ID' },
        x: { type: 'number', description: 'X coordinate (fallback if no nodeId)' },
        y: { type: 'number', description: 'Y coordinate (fallback if no nodeId)' },
      },
    },
  },
  {
    name: 'long_press',
    description: 'Long press a UI element by its node ID or screen coordinates (opens context menus, selects text)',
    parameters: {
      type: 'object',
      properties: {
        nodeId: { type: 'string', description: 'Accessibility node ID' },
        x: { type: 'number', description: 'X coordinate (fallback if no nodeId)' },
        y: { type: 'number', description: 'Y coordinate (fallback if no nodeId)' },
      },
    },
  },
  {
    name: 'type_text',
    description:
      'Set text in an input field. If nodeId is omitted, the currently focused editable field is used. Always tap the field first to focus it before calling type_text without a nodeId.',
    parameters: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'Text to set (replaces existing content)' },
        nodeId: {
          type: 'string',
          description: 'Node ID of the editable field (optional, auto-detects focused field if omitted)',
        },
      },
      required: ['text'],
    },
  },
  {
    name: 'clear_text',
    description:
      'Clear all text from an input field. If nodeId is omitted, the currently focused editable field is used. Prefer this over type_text with empty string when you want to confirm clearing.',
    parameters: {
      type: 'object',
      properties: {
        nodeId: {
          type: 'string',
          description: 'Node ID of the editable field (optional, auto-detects focused field if omitted)',
        },
      },
    },
  },
  {
    name: 'press_enter',
    description:
      'Press the Enter / IME action key on an input field to submit a search, send a message, or confirm input. If nodeId is omitted, the currently focused editable field is used.',
    parameters: {
      type: 'object',
      properties: {
        nodeId: {
          type: 'string',
          description: 'Node ID of the editable field (optional, auto-detects focused field if omitted)',
        },
      },
    },
  },
  {
    name: 'swipe',
    description: 'Swipe between two points on the screen',
    parameters: {
      type: 'object',
      properties: {
        startX: { type: 'number', description: 'Start X coordinate' },
        startY: { type: 'number', description: 'Start Y coordinate' },
        endX: { type: 'number', description: 'End X coordinate' },
        endY: { type: 'number', description: 'End Y coordinate' },
        durationMs: { type: 'number', description: 'Duration in milliseconds (default 300)' },
      },
      required: ['startX', 'startY', 'endX', 'endY'],
    },
  },
  {
    name: 'scroll',
    description:
      'Scroll a scrollable element in a direction. If nodeId is omitted, the first scrollable container on screen is used automatically.',
    parameters: {
      type: 'object',
      properties: {
        nodeId: {
          type: 'string',
          description: 'Node ID of the scrollable element (optional, auto-detects if omitted)',
        },
        direction: {
          type: 'string',
          description: 'Scroll direction',
          enum: ['up', 'down', 'left', 'right'],
        },
      },
      required: ['direction'],
    },
  },
  {
    name: 'open_app',
    description: 'Open an app by its Android package name',
    parameters: {
      type: 'object',
      properties: {
        packageName: { type: 'string', description: 'Android package name (e.g. com.android.settings)' },
      },
      required: ['packageName'],
    },
  },
  {
    name: 'read_screen',
    description: 'Capture the current screen state as structured text',
    parameters: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'screenshot',
    description: 'Take a screenshot for visual analysis',
    parameters: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'global_action',
    description: 'Execute a system action (home, back, recents, notifications)',
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          description: 'The system action to perform',
          enum: ['home', 'back', 'recents', 'notifications', 'quickSettings', 'powerDialog'],
        },
      },
      required: ['action'],
    },
  },
  {
    name: 'wait',
    description: 'Wait for the screen to update before observing again',
    parameters: {
      type: 'object',
      properties: {
        ms: { type: 'number', description: 'Milliseconds to wait (default 1000)' },
      },
    },
  },
  {
    name: 'list_apps',
    description: 'List all user-launchable apps installed on the device. Returns an array of { packageName, label } objects. Use this when you need to find a package name before calling open_app.',
    parameters: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'find_node',
    description: 'Search the accessibility tree for a node by text, content description, class name, or state. Returns the nodeId of the first match, or null if not found. Use this before tapping to verify a node exists and get its ID.',
    parameters: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'Substring to match against node text (case-sensitive)' },
        contentDescription: { type: 'string', description: 'Substring to match against node content description' },
        className: { type: 'string', description: 'Exact class name to match (e.g. android.widget.Button)' },
        isChecked: { type: 'boolean', description: 'Filter by checked state (true=checked, false=unchecked)' },
        isEnabled: { type: 'boolean', description: 'Filter by enabled state (false to find disabled nodes)' },
      },
    },
  },
  {
    name: 'find_all_nodes',
    description: 'Search the accessibility tree for ALL nodes matching the query. Returns an array of nodeIds (may be empty). Use when you need to iterate over multiple matching elements, e.g. all checkboxes or all list items.',
    parameters: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'Substring to match against node text (case-sensitive)' },
        contentDescription: { type: 'string', description: 'Substring to match against node content description' },
        className: { type: 'string', description: 'Exact class name to match (e.g. android.widget.Button)' },
        isChecked: { type: 'boolean', description: 'Filter by checked state (true=checked, false=unchecked)' },
        isEnabled: { type: 'boolean', description: 'Filter by enabled state (false to find disabled nodes)' },
      },
    },
  },
  {
    name: 'wait_for_node',
    description:
      'Poll the accessibility tree until a node matching the query appears, then return its nodeId. Returns null if the timeout expires before the node is found. Use after actions that trigger async UI changes (e.g. navigation, loading screens).',
    parameters: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'Substring to match against node text (case-sensitive)' },
        contentDescription: { type: 'string', description: 'Substring to match against node content description' },
        className: { type: 'string', description: 'Exact class name to match (e.g. android.widget.Button)' },
        isChecked: { type: 'boolean', description: 'Filter by checked state (true=checked, false=unchecked)' },
        isEnabled: { type: 'boolean', description: 'Filter by enabled state (false to find disabled nodes)' },
        timeoutMs: { type: 'number', description: 'Maximum wait time in milliseconds (default 5000)' },
        intervalMs: { type: 'number', description: 'Poll interval in milliseconds (default 500)' },
      },
    },
  },
  {
    name: 'get_node_text',
    description:
      'Get the text content and content description of a specific node by its ID. More efficient than read_screen when you only need the value of one element (e.g. to verify a field value or read a label).',
    parameters: {
      type: 'object',
      properties: {
        nodeId: { type: 'string', description: 'Accessibility node ID to read text from' },
      },
      required: ['nodeId'],
    },
  },
  {
    name: 'task_complete',
    description: 'Signal that the task has been completed successfully',
    parameters: {
      type: 'object',
      properties: {
        summary: { type: 'string', description: 'Brief summary of what was accomplished' },
      },
      required: ['summary'],
    },
  },
  {
    name: 'task_failed',
    description: 'Signal that the task cannot be completed. Use this when the task is impossible, blocked, or requires unavailable permissions. Prefer this over running until the step limit.',
    parameters: {
      type: 'object',
      properties: {
        reason: { type: 'string', description: 'Explanation of why the task failed or is impossible' },
      },
      required: ['reason'],
    },
  },
];

/**
 * Named subsets of PHONE_TOOLS for use with `AgentOptions.toolFilter`.
 *
 * Pass one of these arrays (or a custom list) to `toolFilter` to restrict
 * which actions the LLM can take for a given task. `task_complete` and
 * `task_failed` are always included by the agent loop regardless.
 *
 * @example
 * // Read-only analysis — agent can observe but not act
 * new AgentLoop({ provider, toolFilter: PHONE_TOOL_PRESETS.READ_ONLY })
 *
 * // Form-filling — agent can interact with inputs but not navigate freely
 * new AgentLoop({ provider, toolFilter: PHONE_TOOL_PRESETS.TEXT_INPUT })
 */
export const PHONE_TOOL_PRESETS = {
  /** All available tools (default — same as omitting toolFilter). */
  FULL: undefined as string[] | undefined,

  /** Read the screen and take screenshots only. No actions are taken. */
  READ_ONLY: ['read_screen', 'screenshot', 'list_apps'] as string[],

  /** Navigate the phone: tap, swipe, scroll, open apps, use system buttons. No text input. */
  NAVIGATION: [
    'tap',
    'long_press',
    'swipe',
    'scroll',
    'global_action',
    'open_app',
    'list_apps',
    'find_node',
    'find_all_nodes',
    'wait',
    'wait_for_node',
    'get_node_text',
    'read_screen',
  ] as string[],

  /**
   * Fill forms and interact with text fields.
   * Includes tap (to focus fields) but restricts free navigation.
   */
  TEXT_INPUT: [
    'tap',
    'type_text',
    'clear_text',
    'press_enter',
    'find_node',
    'find_all_nodes',
    'wait_for_node',
    'get_node_text',
    'scroll',
    'read_screen',
  ] as string[],

  /**
   * Access the info/settings of a specific app without leaving it.
   * Excludes open_app and global_action (HOME/BACK) to prevent navigating away.
   */
  IN_APP: [
    'tap',
    'long_press',
    'type_text',
    'clear_text',
    'press_enter',
    'swipe',
    'scroll',
    'find_node',
    'find_all_nodes',
    'wait',
    'wait_for_node',
    'get_node_text',
    'read_screen',
    'screenshot',
  ] as string[],
} as const;
