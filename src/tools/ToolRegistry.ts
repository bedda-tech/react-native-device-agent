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
    tool: Tool,
    handler: (args: Record<string, unknown>) => Promise<unknown>,
  ): void {
    this.tools.set(tool.name, tool);
    this.handlers.set(tool.name, handler);
  }

  /**
   * Get all registered tool definitions (for passing to the LLM).
   */
  getTools(): Tool[] {
    return Array.from(this.tools.values());
  }

  /**
   * Execute a tool call using the registered handler.
   *
   * @throws Error if the tool is not registered
   */
  async execute(call: ToolCall): Promise<unknown> {
    const handler = this.handlers.get(call.name);
    if (!handler) {
      throw new Error(
        `No handler registered for tool "${call.name}". ` +
          `Available: ${Array.from(this.handlers.keys()).join(', ')}`,
      );
    }
    return handler(call.arguments);
  }

  /**
   * Check whether a tool is registered.
   */
  has(name: string): boolean {
    return this.tools.has(name);
  }
}
