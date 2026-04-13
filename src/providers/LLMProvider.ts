import type { LLMProviderInterface, Tool } from '../types';

/**
 * Abstract base class for LLM providers.
 *
 * Concrete implementations handle the specifics of on-device inference
 * (GemmaProvider) or cloud API calls (CloudProvider). The AgentLoop
 * interacts only with this interface.
 */
export abstract class LLMProvider implements LLMProviderInterface {
  /**
   * Generate a plain text response from the model.
   */
  abstract generate(prompt: string): Promise<string>;

  /**
   * Generate a response that may include tool/function calls.
   *
   * The provider is responsible for formatting the tools into whatever
   * schema the underlying model expects and parsing the response.
   */
  abstract generateWithTools(prompt: string, tools: Tool[]): Promise<string>;
}
