import type { Tool } from '../types';
import { LLMProvider } from './LLMProvider';

/**
 * On-device LLM provider using Gemma 4 via react-native-executorch.
 *
 * Runs inference entirely on the device with no network calls.
 * Requires the ExecuTorch .pte model to be downloaded to the device.
 *
 * The actual react-native-executorch integration is injected via the
 * `generateFn` option, keeping this class testable without a running
 * React Native bridge.
 */
export interface GemmaProviderOptions {
  /** Model identifier (e.g., GEMMA4_E4B, GEMMA4_E2B). */
  model: string;
  /** Maximum tokens to generate per response. Default: 512. */
  maxTokens?: number;
  /** Temperature for sampling. Default: 0.7. */
  temperature?: number;
  /**
   * Injected generation function from react-native-executorch.
   * If not provided the provider will throw indicating that the
   * ExecuTorch bridge is required.
   *
   * Example usage with the hook:
   *   const { generate } = useLLM({ model: GEMMA4_E4B });
   *   new GemmaProvider({ model: 'GEMMA4_E4B', generateFn: generate })
   */
  generateFn?: (prompt: string) => Promise<string>;
}

export class GemmaProvider extends LLMProvider {
  private options: Required<GemmaProviderOptions>;

  constructor(options: GemmaProviderOptions) {
    super();
    this.options = {
      maxTokens: 512,
      temperature: 0.7,
      generateFn: GemmaProvider.notImplemented,
      ...options,
    };
  }

  /**
   * Generate a plain text response from the on-device Gemma model.
   */
  async generate(prompt: string): Promise<string> {
    return this.options.generateFn(prompt);
  }

  /**
   * Generate a response with tool schemas injected into the system prompt.
   *
   * Gemma 4 uses function-calling syntax. We embed the tool schemas as a
   * JSON block in the prompt and ask the model to respond with a tool call.
   * The response is returned as-is for ToolParser to handle.
   */
  async generateWithTools(prompt: string, tools: Tool[]): Promise<string> {
    const systemBlock = GemmaProvider.buildToolSystemPrompt(tools);
    const fullPrompt = `${systemBlock}\n\n${prompt}`;
    return this.options.generateFn(fullPrompt);
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Build a system-prompt block that describes the available tools.
   *
   * The format matches Gemma 4's expected function-calling template:
   *
   *   You have access to the following tools:
   *   [{"name": "tap", "description": "...", "parameters": {...}}, ...]
   *
   *   To call a tool, respond ONLY with a JSON object in this format:
   *   {"name": "<tool>", "arguments": {...}}
   *
   *   To call multiple tools in sequence, respond with a JSON array:
   *   [{"name": "<tool>", "arguments": {...}}, ...]
   */
  private static buildToolSystemPrompt(tools: Tool[]): string {
    const schemas = tools.map((t) => ({
      name: t.name,
      description: t.description,
      parameters: {
        type: t.parameters.type,
        properties: t.parameters.properties,
        required: t.parameters.required ?? [],
      },
    }));

    return [
      'You are a phone automation agent. You control an Android phone by calling tools.',
      '',
      'Available tools:',
      JSON.stringify(schemas, null, 2),
      '',
      'To call a tool, respond ONLY with valid JSON in one of these formats:',
      '  Single call:   {"name": "<tool>", "arguments": {...}}',
      '  Multiple calls: [{"name": "<tool>", "arguments": {...}}, ...]',
      '',
      'Do not include any other text, explanation, or markdown.',
    ].join('\n');
  }

  private static async notImplemented(_prompt: string): Promise<string> {
    throw new Error(
      'GemmaProvider requires a generateFn from react-native-executorch. ' +
        'Pass it via the generateFn option:\n\n' +
        '  const { generate } = useLLM({ model: GEMMA4_E4B });\n' +
        '  new GemmaProvider({ model: "GEMMA4_E4B", generateFn: generate })',
    );
  }
}
