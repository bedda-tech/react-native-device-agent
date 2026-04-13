import type { Tool } from '../types';
import { LLMProvider } from './LLMProvider';

/**
 * Cloud LLM provider for fallback when on-device inference is insufficient.
 *
 * Supports OpenAI, Anthropic, and other API-compatible providers.
 * Used as a fallback for complex tasks or on devices that cannot run
 * Gemma 4 efficiently.
 */
export interface CloudProviderOptions {
  /** API key for the cloud provider. */
  apiKey: string;
  /** Model identifier (e.g., 'claude-sonnet-4-6', 'gpt-4o'). */
  model: string;
  /** Base URL for the API (defaults to provider's standard URL). */
  baseUrl?: string;
  /** Maximum tokens to generate per response. Default: 1024. */
  maxTokens?: number;
  /** Temperature for sampling. Default: 0.7. */
  temperature?: number;
}

export class CloudProvider extends LLMProvider {
  private options: CloudProviderOptions;

  constructor(options: CloudProviderOptions) {
    super();
    this.options = options;
  }

  async generate(_prompt: string): Promise<string> {
    throw new Error('Not implemented: CloudProvider.generate');
  }

  async generateWithTools(_prompt: string, _tools: Tool[]): Promise<string> {
    throw new Error('Not implemented: CloudProvider.generateWithTools');
  }
}
