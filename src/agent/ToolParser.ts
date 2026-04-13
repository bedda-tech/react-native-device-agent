import type { ToolCall } from '../types';

/**
 * Parses LLM text output into structured tool calls.
 *
 * Supports multiple output formats:
 * - Native function calling (structured JSON from model)
 * - XML-style tool tags (e.g., <tool_call>...</tool_call>)
 * - JSON code blocks in markdown
 */
export class ToolParser {
  /**
   * Parse one or more tool calls from raw LLM output.
   *
   * @param output - Raw text response from the LLM
   * @returns Array of parsed tool calls
   */
  static parse(_output: string): ToolCall[] {
    throw new Error('Not implemented: ToolParser.parse');
  }

  /**
   * Validate that a tool call matches its schema.
   *
   * @param call - The parsed tool call
   * @param schema - The tool's parameter schema
   * @returns True if the call is valid
   */
  static validate(_call: ToolCall, _schema: unknown): boolean {
    throw new Error('Not implemented: ToolParser.validate');
  }
}
