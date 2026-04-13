import type { Tool } from '../types';
import { LLMProvider } from './LLMProvider';

/**
 * On-device LLM provider using Gemma 4 via react-native-executorch.
 *
 * Runs inference entirely on the device with no network calls.
 * Requires the ExecuTorch .pte model to be downloaded to the device.
 */
export interface GemmaProviderOptions {
  /** Model identifier (e.g., GEMMA4_E4B, GEMMA4_E2B). */
  model: string;
  /** Maximum tokens to generate per response. Default: 512. */
  maxTokens?: number;
  /** Temperature for sampling. Default: 0.7. */
  temperature?: number;
}

export class GemmaProvider extends LLMProvider {
  private options: GemmaProviderOptions;

  constructor(options: GemmaProviderOptions) {
    super();
    this.options = options;
  }

  async generate(_prompt: string): Promise<string> {
    throw new Error(
      'Not implemented: GemmaProvider.generate -- requires react-native-executorch integration',
    );
  }

  async generateWithTools(_prompt: string, _tools: Tool[]): Promise<string> {
    throw new Error(
      'Not implemented: GemmaProvider.generateWithTools -- requires react-native-executorch integration',
    );
  }
}
