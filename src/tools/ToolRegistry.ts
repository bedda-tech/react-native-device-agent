import type { Tool, ToolCall } from '../types';

/**
 * Registry for available agent tools.
 *
 * The registry holds tool definitions and their execution handlers.
 * Default phone tools are registered automatically; custom tools can
 * be added at runtime.
 */
export class ToolRegistry {
  private tools: Map<string, Tool> = new Map();
  private handlers: Map<string, (args: Record<string, unknown>) => Promise<unknown>> =
    new Map();

  /**
   * Register a tool with its definition and execution handler.
   */
  register(
    _tool: Tool,
    _handler: (args: Record<string, unknown>) => Promise<unknown>,
  ): void {
    throw new Error('Not implemented: ToolRegistry.register');
  }

  /**
   * Get all registered tool definitions (for passing to the LLM).
   */
  getTools(): Tool[] {
    throw new Error('Not implemented: ToolRegistry.getTools');
  }

  /**
   * Execute a tool call using the registered handler.
   */
  async execute(_call: ToolCall): Promise<unknown> {
    throw new Error('Not implemented: ToolRegistry.execute');
  }

  /**
   * Check whether a tool is registered.
   */
  has(name: string): boolean {
    return this.tools.has(name);
  }
}
