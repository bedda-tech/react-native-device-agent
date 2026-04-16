/**
 * Configuration for the agent loop.
 */
export interface AgentOptions {
  /** LLM provider instance (on-device or cloud). */
  provider: LLMProviderInterface;
  /** Maximum number of observe-think-act cycles before giving up. Default: 20. */
  maxSteps?: number;
  /** Milliseconds to wait after an action for the screen to settle. Default: 500. */
  settleMs?: number;
  /**
   * Enable vision mode: capture a screenshot at each observation step and
   * pass it to the provider alongside the accessibility tree text.
   *
   * Requires `provider` to implement `generateWithVision` (e.g. GemmaProvider
   * configured with a `generateWithImageFn`). Falls back to text-only if the
   * provider does not implement `generateWithVision`.
   *
   * Default: false.
   */
  useVision?: boolean;
  /** Callback invoked on every action the agent takes. */
  onAction?: (action: AgentAction) => void;
  /** Callback invoked when the agent completes a task. */
  onComplete?: (result: string) => void;
  /** Callback invoked on error. */
  onError?: (error: Error) => void;
}

/**
 * Events yielded by the agent loop generator.
 */
export type AgentEvent =
  | { type: 'action'; tool: string; args: Record<string, unknown> }
  | { type: 'observation'; screenState: string; step: number; screenshotPath?: string }
  | { type: 'thinking'; content: string }
  | { type: 'complete'; result: string }
  | { type: 'error'; error: Error }
  | { type: 'max_steps_reached' };

/**
 * A single action taken by the agent.
 */
export interface AgentAction {
  tool: string;
  args: Record<string, unknown>;
  timestamp: number;
}

/**
 * A parsed tool call extracted from LLM output.
 */
export interface ToolCall {
  name: string;
  arguments: Record<string, unknown>;
}

/**
 * Definition of a tool the agent can use.
 */
export interface Tool {
  name: string;
  description: string;
  parameters: ToolParameters;
}

/**
 * JSON Schema-style parameter definition for a tool.
 */
export interface ToolParameters {
  type: 'object';
  properties: Record<string, ToolProperty>;
  required?: string[];
}

/**
 * A single property in a tool's parameter schema.
 */
export interface ToolProperty {
  type: 'string' | 'number' | 'boolean' | 'object' | 'array';
  description?: string;
  enum?: string[];
}

/**
 * Abstract interface that all LLM providers must implement.
 */
export interface LLMProviderInterface {
  /** Generate a text response. */
  generate(prompt: string): Promise<string>;
  /** Generate a response with tool-calling support. */
  generateWithTools(prompt: string, tools: Tool[]): Promise<string>;
  /**
   * Generate a response with tool-calling support and a screenshot image.
   * Providers that do not support vision may fall back to `generateWithTools`.
   * @param prompt - The text prompt
   * @param tools - Available tools
   * @param imagePath - Local file path to the screenshot (no `file://` prefix)
   */
  generateWithVision?(
    prompt: string,
    tools: Tool[],
    imagePath: string,
  ): Promise<string>;
}

/**
 * State returned by the useAgent hook.
 */
export interface UseAgentState {
  /** Whether the agent is currently running a task. */
  isRunning: boolean;
  /** History of events from the current or most recent task. */
  history: AgentEvent[];
  /** Start executing a task. */
  execute: (task: string) => Promise<void>;
  /** Stop the currently running task. */
  stop: () => void;
}

/**
 * Chat message in the agent conversation.
 */
export interface ChatMessage {
  role: 'user' | 'agent' | 'system';
  content: string;
  timestamp: number;
  action?: AgentAction;
}
