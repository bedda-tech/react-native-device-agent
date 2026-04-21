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
  tapNode: (nodeId: string) => Promise<boolean>;
  tap: (x: number, y: number) => Promise<boolean>;
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
  private options: AgentOptions & { maxSteps: number; settleMs: number; useVision: boolean };
  private aborted = false;
  private registry: ToolRegistry;
  private tools: Tool[];

  constructor(options: AgentOptions) {
    this.options = {
      maxSteps: 20,
      settleMs: 500,
      useVision: false,
      ...options,
    };
    this.registry = new ToolRegistry();
    this.tools = [...PHONE_TOOLS];
    this.registerDefaultTools();
  }

  /**
   * Run the agent loop for a given task. Yields events for each step.
   *
   * @param task - Natural language description of what the user wants done
   */
  async *run(task: string): AsyncGenerator<AgentEvent> {
    let steps = 0;
    const history: AgentEvent[] = [];

    // Initial screen observation
    let screenState: string;
    try {
      screenState = await this.readScreen();
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      yield { type: 'error', error };
      return;
    }

    while (steps < this.options.maxSteps && !this.aborted) {
      // Build the prompt
      const prompt = this.buildPrompt(task, screenState, history);

      // LLM inference (vision or text-only)
      let response: string;
      try {
        if (this.options.useVision && this.options.provider.generateWithVision) {
          const screenshotPath = await this.captureScreenshot();
          if (screenshotPath) {
            response = await this.options.provider.generateWithVision(prompt, this.tools, screenshotPath);
          } else {
            response = await this.options.provider.generateWithTools(prompt, this.tools);
          }
        } else {
          response = await this.options.provider.generateWithTools(prompt, this.tools);
        }
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        yield { type: 'error', error };
        return;
      }

      // Emit thinking event if the model returned anything before tool calls
      const thinking = extractThinkingText(response);
      if (thinking) {
        const event: AgentEvent = { type: 'thinking', content: thinking };
        history.push(event);
        yield event;
      }

      // Parse tool calls from the response
      const toolCalls = ToolParser.parse(response);

      if (toolCalls.length === 0) {
        // No tool calls -- model may have responded with plain text.
        // Treat as a thinking step and continue.
        steps++;
        const obsEvent: AgentEvent = { type: 'observation', screenState, step: steps };
        history.push(obsEvent);
        yield obsEvent;
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
          return;
        }

        // Emit action event
        const actionEvent: AgentEvent = { type: 'action', tool: call.name, args: call.arguments };
        history.push(actionEvent);
        yield actionEvent;

        // Execute the action
        try {
          await this.executeToolCall(call);
        } catch (err) {
          const error = err instanceof Error ? err : new Error(String(err));
          const errEvent: AgentEvent = { type: 'error', error };
          history.push(errEvent);
          yield errEvent;
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
        return;
      }

      steps++;
      const obsEvent: AgentEvent = { type: 'observation', screenState, step: steps, screenshotPath };
      history.push(obsEvent);
      yield obsEvent;
    }

    yield { type: 'max_steps_reached' };
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
    return ScreenSerializer.serialize(tree);
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

  private buildPrompt(task: string, screenState: string, history: AgentEvent[]): string {
    const historyText = this.formatHistory(history);

    return [
      `Task: ${task}`,
      '',
      'Current screen:',
      screenState,
      historyText ? `\nAction history:\n${historyText}` : '',
      '',
      'What is the next action to take? Respond with a tool call.',
    ]
      .filter(Boolean)
      .join('\n');
  }

  private formatHistory(history: AgentEvent[]): string {
    const relevant = history.filter(
      (e) => e.type === 'action' || e.type === 'observation',
    );
    if (relevant.length === 0) return '';

    return relevant
      .map((e) => {
        if (e.type === 'action') {
          return `- Called ${e.tool}(${JSON.stringify(e.args)})`;
        }
        if (e.type === 'observation') {
          return `- Step ${e.step}: observed screen`;
        }
        return '';
      })
      .filter(Boolean)
      .join('\n');
  }

  private async executeToolCall(call: ToolCall): Promise<void> {
    await this.registry.execute(call);
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

    this.registry.register(phoneTool('type_text'), async (args) => {
      const ctrl = getController();
      const text = String(args.text ?? '');
      const nodeId = args.nodeId ? String(args.nodeId) : null;
      if (nodeId) {
        return ctrl.setNodeText(nodeId, text);
      }
      // No nodeId -- try to type into whatever is currently focused.
      // AccessibilityController doesn't expose a direct "type" API without
      // a node ID, so we fall back to setNodeText with an empty string as
      // a no-op signal; real implementation will inject via IME.
      throw new Error('type_text requires a nodeId targeting an editable field');
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
      return ctrl.scrollNode(String(args.nodeId), String(args.direction));
    });

    this.registry.register(phoneTool('open_app'), async (args) => {
      const ctrl = getController();
      return ctrl.openApp(String(args.packageName));
    });

    this.registry.register(phoneTool('read_screen'), async () => {
      return this.readScreen();
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

    // task_complete is handled specially in the loop, but register a no-op
    // so registry.has('task_complete') returns true.
    this.registry.register(phoneTool('task_complete'), async () => true);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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
