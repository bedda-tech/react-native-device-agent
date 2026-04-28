import type { AgentEvent, AgentOptions, ToolCall, Tool } from '../types';
import { ScreenSerializer } from './ScreenSerializer';
import { ScreenshotPreprocessor } from './ScreenshotPreprocessor';
import { ToolParser } from './ToolParser';
import { PHONE_TOOLS } from '../tools/PhoneTools';
import { ToolRegistry } from '../tools/ToolRegistry';

// react-native-accessibility-controller is a peer dep; import lazily so the
// package can compile in environments where the native module is absent.
let AccessibilityController: {
  getAccessibilityTree: () => Promise<unknown>;
  performAction: (nodeId: string, action: string) => Promise<boolean>;
  tapNode: (nodeId: string) => Promise<boolean>;
  tap: (x: number, y: number) => Promise<boolean>;
  longPressNode: (nodeId: string) => Promise<boolean>;
  longPress: (x: number, y: number) => Promise<boolean>;
  setNodeText: (nodeId: string, text: string) => Promise<boolean>;
  swipe: (
    startX: number,
    startY: number,
    endX: number,
    endY: number,
    durationMs?: number,
  ) => Promise<boolean>;
  scrollNode: (nodeId: string, direction: string) => Promise<boolean>;
  openApp: (packageName: string) => Promise<boolean>;
  getInstalledApps: () => Promise<Array<{ packageName: string; label: string }>>;
  globalAction: (action: string) => Promise<boolean>;
  takeScreenshot: () => Promise<string>;
} | null = null;

function getController() {
  if (!AccessibilityController) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      AccessibilityController = require('react-native-accessibility-controller');
    } catch {
      throw new Error(
        'react-native-accessibility-controller is not available. ' +
          'Ensure the native module is linked and running on a real device.',
      );
    }
  }
  return AccessibilityController!;
}

/**
 * Core agent loop: observe -> think -> act -> repeat.
 *
 * The loop reads the current screen state, asks the LLM to decide what to do,
 * parses tool calls from the response, executes them via the accessibility
 * controller, then observes the new screen state. This continues until the
 * task is complete or the step limit is reached.
 */
export class AgentLoop {
  private options: AgentOptions & {
    maxSteps: number;
    settleMs: number;
    useVision: boolean;
    retryOnError: number;
    systemPromptSuffix: string;
    maxScreenLength: number;
    timeoutMs: number;
  };
  private aborted = false;
  private registry: ToolRegistry;
  private tools: Tool[];

  private _running = false;
  private _step = 0;
  private _task: string | null = null;

  /** True while the agent loop is executing a task. */
  get isRunning(): boolean { return this._running; }
  /** Current step count (increments after each observation). */
  get step(): number { return this._step; }
  /** The task string passed to the most recent run() call, or null when idle. */
  get task(): string | null { return this._task; }

  constructor(options: AgentOptions) {
    this.options = {
      maxSteps: 20,
      settleMs: 500,
      useVision: false,
      retryOnError: 0,
      systemPromptSuffix: '',
      maxScreenLength: 6000,
      timeoutMs: 0,
      ...options,
    };
    this.registry = new ToolRegistry();
    const { toolFilter } = options;
    if (toolFilter) {
      const allowed = new Set([...toolFilter, 'task_complete', 'task_failed']);
      this.tools = PHONE_TOOLS.filter((t) => allowed.has(t.name));
    } else {
      this.tools = [...PHONE_TOOLS];
    }
    this.registerDefaultTools();
  }

  /**
   * Run the agent loop for a given task. Yields events for each step.
   *
   * @param task - Natural language description of what the user wants done
   */
  async *run(task: string): AsyncGenerator<AgentEvent> {
    this._running = true;
    this._task = task;
    this._step = 0;
    const history: AgentEvent[] = [];

    try {
    // Initial screen observation
    let screenState: string;
    try {
      screenState = await this.readScreen();
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      yield { type: 'error', error };
      this.options.onError?.(error);
      return;
    }

    const startTime = Date.now();

    while (this._step < this.options.maxSteps && !this.aborted) {
      if (this.options.timeoutMs > 0 && Date.now() - startTime >= this.options.timeoutMs) {
        yield { type: 'timeout' };
        this.options.onTimeout?.();
        return;
      }

      // Build the prompt
      const prompt = this.buildPrompt(task, screenState, history);

      // LLM inference (vision or text-only), with optional retry on failure.
      let response: string;
      try {
        response = await this.inferWithRetry(prompt);
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        yield { type: 'error', error };
        this.options.onError?.(error);
        return;
      }

      // Emit thinking event if the model returned anything before tool calls
      const thinking = extractThinkingText(response);
      if (thinking) {
        const event: AgentEvent = { type: 'thinking', content: thinking };
        history.push(event);
        yield event;
        this.options.onThinking?.(thinking);
      }

      // Parse tool calls from the response
      const toolCalls = ToolParser.parse(response);

      if (toolCalls.length === 0) {
        // No tool calls -- model may have responded with plain text.
        // Treat as a thinking step and continue.
        this._step++;
        const obsEvent: AgentEvent = { type: 'observation', screenState, step: this._step };
        history.push(obsEvent);
        yield obsEvent;
        this.options.onObservation?.({ screenState, step: this._step });
        continue;
      }

      // Execute each tool call in sequence
      for (const call of toolCalls) {
        if (this.aborted) break;

        if (call.name === 'task_complete') {
          const result = (call.arguments.summary as string) ?? 'Task completed.';
          const completeEvent: AgentEvent = { type: 'complete', result };
          history.push(completeEvent);
          yield completeEvent;
          this.options.onComplete?.(result);
          return;
        }

        if (call.name === 'task_failed') {
          const reason = (call.arguments.reason as string) ?? 'Task failed.';
          const failedEvent: AgentEvent = { type: 'failed', reason };
          history.push(failedEvent);
          yield failedEvent;
          this.options.onFailed?.(reason);
          return;
        }

        // Emit action event before execution so the UI can show in-flight state.
        // We hold a mutable reference so we can backfill result after execution.
        const actionEvent: Extract<AgentEvent, { type: 'action' }> = {
          type: 'action',
          tool: call.name,
          args: call.arguments,
        };
        history.push(actionEvent);
        yield actionEvent;
        this.options.onAction?.({ tool: call.name, args: call.arguments, timestamp: Date.now() });

        // Execute the action and record the result on the history entry so
        // formatHistory() can annotate success / failure in the next prompt.
        try {
          actionEvent.result = await this.executeToolCall(call);
        } catch (err) {
          const error = err instanceof Error ? err : new Error(String(err));
          actionEvent.result = error;
          const errEvent: AgentEvent = { type: 'error', error };
          history.push(errEvent);
          yield errEvent;
          this.options.onError?.(error);
          // Continue to next step rather than aborting on action failure
        }

        // Wait for screen to settle after action
        await this.delay(this.options.settleMs);
      }

      if (this.aborted) break;

      // Observe new screen state
      let screenshotPath: string | undefined;
      try {
        screenState = await this.readScreen();
        if (this.options.useVision) {
          screenshotPath = (await this.captureScreenshot()) ?? undefined;
        }
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        yield { type: 'error', error };
        this.options.onError?.(error);
        return;
      }

      this._step++;
      const obsEvent: AgentEvent = { type: 'observation', screenState, step: this._step, screenshotPath };
      history.push(obsEvent);
      yield obsEvent;
      this.options.onObservation?.({ screenState, step: this._step });
    }

    if (!this.aborted) {
      yield { type: 'max_steps_reached' };
      this.options.onMaxSteps?.();
    }
    } finally {
      this._running = false;
      this._task = null;
    }
  }

  /**
   * Abort the currently running agent loop.
   */
  abort(): void {
    this.aborted = true;
  }

  // ---------------------------------------------------------------------------
  // Private methods
  // ---------------------------------------------------------------------------

  private async readScreen(): Promise<string> {
    const ctrl = getController();
    const tree = await ctrl.getAccessibilityTree();
    const maxLen = this.options.maxScreenLength;
    return maxLen > 0
      ? ScreenSerializer.summarize(tree, maxLen)
      : ScreenSerializer.serialize(tree);
  }

  private async captureScreenshot(): Promise<string | null> {
    try {
      const ctrl = getController();
      const raw = await ctrl.takeScreenshot();
      return ScreenshotPreprocessor.normalizePath(raw);
    } catch {
      return null;
    }
  }

  private async inferWithRetry(prompt: string): Promise<string> {
    const maxAttempts = 1 + this.options.retryOnError;
    let lastError: Error = new Error('inference failed');
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      if (attempt > 0) {
        await this.delay(Math.pow(2, attempt - 1) * 500);
      }
      try {
        if (this.options.useVision && this.options.provider.generateWithVision) {
          const screenshotPath = await this.captureScreenshot();
          if (screenshotPath) {
            return await this.options.provider.generateWithVision(prompt, this.tools, screenshotPath);
          }
        }
        return await this.options.provider.generateWithTools(prompt, this.tools);
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
      }
    }
    throw lastError;
  }

  private buildPrompt(task: string, screenState: string, history: AgentEvent[]): string {
    const historyText = this.formatHistory(history, this.options.maxHistoryItems);
    const suffix = (this.options.systemPromptSuffix ?? '').trim();

    return [
      `Task: ${task}`,
      '',
      'Current screen:',
      screenState,
      historyText ? `\nAction history:\n${historyText}` : '',
      suffix ? `\nAdditional instructions:\n${suffix}` : '',
      '',
      'What is the next action to take? Respond with a tool call.',
    ]
      .filter(Boolean)
      .join('\n');
  }

  private formatHistory(history: AgentEvent[], maxItems?: number): string {
    const relevant = history.filter(
      (e) => e.type === 'action' || e.type === 'observation',
    );
    if (relevant.length === 0) return '';

    const limit = maxItems && maxItems > 0 ? maxItems : 0;
    const pruned =
      limit > 0 && relevant.length > limit
        ? relevant.slice(relevant.length - limit)
        : relevant;
    const omitted = relevant.length - pruned.length;
    const prefix = omitted > 0 ? `[${omitted} earlier actions omitted]\n` : '';

    return (
      prefix +
      pruned
        .map((e) => {
          if (e.type === 'action') {
            const base = `- Called ${e.tool}(${JSON.stringify(e.args)})`;
            return `${base}${formatToolResult(e.result)}`;
          }
          if (e.type === 'observation') {
            return `- Step ${e.step}: observed screen`;
          }
          return '';
        })
        .filter(Boolean)
        .join('\n')
    );
  }

  private async executeToolCall(call: ToolCall): Promise<unknown> {
    return this.registry.execute(call);
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // ---------------------------------------------------------------------------
  // Default tool handlers (wired to react-native-accessibility-controller)
  // ---------------------------------------------------------------------------

  private registerDefaultTools(): void {
    const phoneTool = (name: string) =>
      PHONE_TOOLS.find((t) => t.name === name)!;

    this.registry.register(phoneTool('tap'), async (args) => {
      const ctrl = getController();
      if (typeof args.nodeId === 'string' && args.nodeId) {
        return ctrl.tapNode(args.nodeId);
      }
      const x = Number(args.x ?? 0);
      const y = Number(args.y ?? 0);
      return ctrl.tap(x, y);
    });

    this.registry.register(phoneTool('long_press'), async (args) => {
      const ctrl = getController();
      if (typeof args.nodeId === 'string' && args.nodeId) {
        return ctrl.longPressNode(args.nodeId);
      }
      const x = Number(args.x ?? 0);
      const y = Number(args.y ?? 0);
      return ctrl.longPress(x, y);
    });

    this.registry.register(phoneTool('type_text'), async (args) => {
      const ctrl = getController();
      const text = String(args.text ?? '');
      let nodeId = args.nodeId ? String(args.nodeId) : null;
      if (!nodeId) {
        // Auto-detect the currently focused editable field.
        const tree = await ctrl.getAccessibilityTree();
        nodeId = findFocusedEditableNode(tree);
        if (!nodeId) {
          throw new Error(
            'type_text: no focused editable field found. Tap the target input first, or provide a nodeId.',
          );
        }
      }
      return ctrl.setNodeText(nodeId, text);
    });

    this.registry.register(phoneTool('clear_text'), async (args) => {
      const ctrl = getController();
      let nodeId = args.nodeId ? String(args.nodeId) : null;
      if (!nodeId) {
        const tree = await ctrl.getAccessibilityTree();
        nodeId = findFocusedEditableNode(tree);
        if (!nodeId) {
          throw new Error(
            'clear_text: no focused editable field found. Tap the target input first, or provide a nodeId.',
          );
        }
      }
      return ctrl.performAction(nodeId, 'clearText');
    });

    this.registry.register(phoneTool('press_enter'), async (args) => {
      const ctrl = getController();
      let nodeId = args.nodeId ? String(args.nodeId) : null;
      if (!nodeId) {
        const tree = await ctrl.getAccessibilityTree();
        nodeId = findFocusedEditableNode(tree);
        if (!nodeId) {
          throw new Error(
            'press_enter: no focused editable field found. Tap the target input first, or provide a nodeId.',
          );
        }
      }
      return ctrl.performAction(nodeId, 'imeEnter');
    });

    this.registry.register(phoneTool('swipe'), async (args) => {
      const ctrl = getController();
      return ctrl.swipe(
        Number(args.startX),
        Number(args.startY),
        Number(args.endX),
        Number(args.endY),
        args.durationMs !== undefined ? Number(args.durationMs) : undefined,
      );
    });

    this.registry.register(phoneTool('scroll'), async (args) => {
      const ctrl = getController();
      let nodeId = args.nodeId ? String(args.nodeId) : null;
      if (!nodeId) {
        const tree = await ctrl.getAccessibilityTree();
        nodeId = findFirstScrollableNode(tree);
        if (!nodeId) {
          throw new Error(
            'scroll: no scrollable element found on screen. Provide a nodeId or ensure the screen has a scrollable container.',
          );
        }
      }
      return ctrl.scrollNode(nodeId, String(args.direction));
    });

    this.registry.register(phoneTool('open_app'), async (args) => {
      const ctrl = getController();
      return ctrl.openApp(String(args.packageName));
    });

    this.registry.register(phoneTool('list_apps'), async () => {
      const ctrl = getController();
      return ctrl.getInstalledApps();
    });

    this.registry.register(phoneTool('read_screen'), async () => {
      return this.readScreen();
    });

    this.registry.register(phoneTool('find_node'), async (args) => {
      const ctrl = getController();
      const tree = await ctrl.getAccessibilityTree();
      return findNodeInTree(tree, {
        text: args.text !== undefined ? String(args.text) : undefined,
        contentDescription: args.contentDescription !== undefined
          ? String(args.contentDescription)
          : undefined,
        className: args.className !== undefined ? String(args.className) : undefined,
      });
    });

    this.registry.register(phoneTool('find_all_nodes'), async (args) => {
      const ctrl = getController();
      const tree = await ctrl.getAccessibilityTree();
      return collectAllNodes(tree, {
        text: args.text !== undefined ? String(args.text) : undefined,
        contentDescription: args.contentDescription !== undefined
          ? String(args.contentDescription)
          : undefined,
        className: args.className !== undefined ? String(args.className) : undefined,
      });
    });

    this.registry.register(phoneTool('screenshot'), async () => {
      const ctrl = getController();
      return ctrl.takeScreenshot();
    });

    this.registry.register(phoneTool('global_action'), async (args) => {
      const ctrl = getController();
      return ctrl.globalAction(String(args.action));
    });

    this.registry.register(phoneTool('wait'), async (args) => {
      const ms = args.ms !== undefined ? Number(args.ms) : 1000;
      await this.delay(ms);
      return true;
    });

    // task_complete and task_failed are handled specially in the loop, but
    // register no-ops so registry.has() returns true for both.
    this.registry.register(phoneTool('task_complete'), async () => true);
    this.registry.register(phoneTool('task_failed'), async () => true);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Format a tool result for inclusion in the history prompt.
 * Returns an empty string when the result is undefined (action still in-flight).
 */
function formatToolResult(result: unknown): string {
  if (result === undefined) return '';
  if (result instanceof Error) return ` → error: ${result.message}`;
  if (result === true) return ' → ok';
  if (result === false) return ' → failed';
  // Strings (e.g. read_screen content) are too long to inline; just note they succeeded.
  if (typeof result === 'string') return result.length > 0 ? ' → ok' : ' → empty';
  return ` → ${String(result)}`;
}

/**
 * Recursively search an accessibility tree for the first node matching the query.
 * Supports both array-of-roots and single-root tree shapes.
 * Returns the nodeId of the matching node, or null if not found.
 */
function findNodeInTree(
  tree: unknown,
  query: { text?: string; contentDescription?: string; className?: string },
): string | null {
  const roots = Array.isArray(tree) ? tree : [tree];
  return searchNodes(roots as Record<string, unknown>[], query);
}

function searchNodes(
  nodes: Record<string, unknown>[],
  query: { text?: string; contentDescription?: string; className?: string },
): string | null {
  for (const node of nodes) {
    const nodeText = typeof node.text === 'string' ? node.text : null;
    const nodeDesc = typeof node.contentDescription === 'string' ? node.contentDescription : null;
    const nodeCls = typeof node.className === 'string' ? node.className : null;

    const matches =
      (query.text !== undefined && nodeText !== null && nodeText.includes(query.text)) ||
      (query.contentDescription !== undefined && nodeDesc !== null && nodeDesc.includes(query.contentDescription)) ||
      (query.className !== undefined && nodeCls === query.className);

    if (matches) {
      return typeof node.nodeId === 'string' ? node.nodeId : null;
    }

    const children = Array.isArray(node.children)
      ? (node.children as Record<string, unknown>[])
      : [];
    const found = searchNodes(children, query);
    if (found) return found;
  }
  return null;
}

/**
 * Collect all nodeIds in the accessibility tree that match the query.
 * Returns an array (possibly empty) of matching nodeIds.
 */
function collectAllNodes(
  tree: unknown,
  query: { text?: string; contentDescription?: string; className?: string },
): string[] {
  const roots = Array.isArray(tree) ? tree : [tree];
  const results: string[] = [];
  gatherNodes(roots as Record<string, unknown>[], query, results);
  return results;
}

function gatherNodes(
  nodes: Record<string, unknown>[],
  query: { text?: string; contentDescription?: string; className?: string },
  results: string[],
): void {
  for (const node of nodes) {
    const nodeText = typeof node.text === 'string' ? node.text : null;
    const nodeDesc = typeof node.contentDescription === 'string' ? node.contentDescription : null;
    const nodeCls = typeof node.className === 'string' ? node.className : null;

    const matches =
      (query.text !== undefined && nodeText !== null && nodeText.includes(query.text)) ||
      (query.contentDescription !== undefined && nodeDesc !== null && nodeDesc.includes(query.contentDescription)) ||
      (query.className !== undefined && nodeCls === query.className);

    if (matches && typeof node.nodeId === 'string') {
      results.push(node.nodeId);
    }

    const children = Array.isArray(node.children)
      ? (node.children as Record<string, unknown>[])
      : [];
    gatherNodes(children, query, results);
  }
}

/**
 * Find the nodeId of the currently focused editable field in the accessibility tree.
 * Returns null if no focused editable node exists.
 */
function findFocusedEditableNode(tree: unknown): string | null {
  const roots = Array.isArray(tree) ? tree : [tree];
  return searchFocusedEditable(roots as Record<string, unknown>[]);
}

function searchFocusedEditable(nodes: Record<string, unknown>[]): string | null {
  for (const node of nodes) {
    if (node.isFocused === true && node.isEditable === true) {
      return typeof node.nodeId === 'string' ? node.nodeId : null;
    }
    const children = Array.isArray(node.children)
      ? (node.children as Record<string, unknown>[])
      : [];
    const found = searchFocusedEditable(children);
    if (found) return found;
  }
  return null;
}

/**
 * Find the nodeId of the first scrollable node in the accessibility tree.
 * Returns null if no scrollable node exists.
 */
function findFirstScrollableNode(tree: unknown): string | null {
  const roots = Array.isArray(tree) ? tree : [tree];
  return searchScrollable(roots as Record<string, unknown>[]);
}

function searchScrollable(nodes: Record<string, unknown>[]): string | null {
  for (const node of nodes) {
    if (node.isScrollable === true) {
      return typeof node.nodeId === 'string' ? node.nodeId : null;
    }
    const children = Array.isArray(node.children)
      ? (node.children as Record<string, unknown>[])
      : [];
    const found = searchScrollable(children);
    if (found) return found;
  }
  return null;
}

/**
 * Extract any plain-text thinking content that appears before tool call JSON.
 * Returns empty string if the response is pure JSON.
 */
function extractThinkingText(response: string): string {
  const trimmed = response.trim();
  // If the response starts with { or [ it's likely pure JSON -- skip.
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) return '';
  // If it contains a JSON block somewhere, grab the text before it.
  const jsonStart = trimmed.search(/[{[]/);
  if (jsonStart > 0) {
    return trimmed.slice(0, jsonStart).trim();
  }
  return trimmed;
}
