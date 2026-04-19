import type { Tool } from '../types';
import { LLMProvider } from './LLMProvider';
import { toOpenAIFunction } from '../tools/ToolSchema';

/**
 * Cloud LLM provider for fallback when on-device inference is insufficient.
 *
 * Supports OpenAI-compatible APIs (OpenAI, Anthropic via OpenAI compat layer,
 * etc.) and the native Anthropic messages API.
 *
 * Used as a fallback for complex tasks or on devices that cannot run
 * Gemma 4 efficiently.
 */
export interface CloudProviderOptions {
  /** API key for the cloud provider. */
  apiKey: string;
  /** Model identifier (e.g., 'claude-sonnet-4-6', 'gpt-4o'). */
  model: string;
  /**
   * Base URL for the API.
   * - OpenAI: 'https://api.openai.com/v1' (default)
   * - Anthropic: 'https://api.anthropic.com/v1'
   * - Local/proxy: any compatible endpoint
   */
  baseUrl?: string;
  /** Maximum tokens to generate per response. Default: 1024. */
  maxTokens?: number;
  /** Temperature for sampling. Default: 0.7. */
  temperature?: number;
  /**
   * Which API format to use.
   * - 'openai': OpenAI chat completions API (default)
   * - 'anthropic': Anthropic messages API
   */
  apiFormat?: 'openai' | 'anthropic';
  /**
   * Optional system prompt injected into every API request.
   *
   * For Anthropic this maps to the top-level `system` field (recommended).
   * For OpenAI it is prepended as a `role: 'system'` message.
   * Leave unset to use the model's default behaviour.
   */
  system?: string;
}

export class CloudProvider extends LLMProvider {
  private options: Required<Omit<CloudProviderOptions, 'system'>> & { system: string | undefined };

  constructor(options: CloudProviderOptions) {
    super();
    this.options = {
      baseUrl: 'https://api.openai.com/v1',
      maxTokens: 1024,
      temperature: 0.7,
      apiFormat: 'openai',
      system: undefined,
      ...options,
    };
  }

  /**
   * Generate a plain text response from the cloud model.
   */
  async generate(prompt: string): Promise<string> {
    return this.options.apiFormat === 'anthropic'
      ? this.anthropicGenerate(prompt)
      : this.openaiGenerate(prompt);
  }

  /**
   * Generate a response with tool schemas injected into the prompt.
   *
   * For cloud providers we use native function calling when supported.
   * The raw text response (which may contain JSON tool calls) is returned
   * for ToolParser to process.
   */
  async generateWithTools(prompt: string, tools: Tool[]): Promise<string> {
    return this.options.apiFormat === 'anthropic'
      ? this.anthropicGenerateWithTools(prompt, tools)
      : this.openaiGenerateWithTools(prompt, tools);
  }

  // ---------------------------------------------------------------------------
  // OpenAI-compatible implementation
  // ---------------------------------------------------------------------------

  private async openaiGenerate(prompt: string): Promise<string> {
    const messages = this.options.system
      ? [{ role: 'system', content: this.options.system }, { role: 'user', content: prompt }]
      : [{ role: 'user', content: prompt }];
    const response = await this.fetchJson(`${this.options.baseUrl}/chat/completions`, {
      model: this.options.model,
      messages,
      max_tokens: this.options.maxTokens,
      temperature: this.options.temperature,
    });
    const choices = response?.choices as Array<{ message?: { content?: string } }> | undefined;
    return choices?.[0]?.message?.content ?? '';
  }

  private async openaiGenerateWithTools(prompt: string, tools: Tool[]): Promise<string> {
    const openaiTools = tools.map(toOpenAIFunction);
    const messages = this.options.system
      ? [{ role: 'system', content: this.options.system }, { role: 'user', content: prompt }]
      : [{ role: 'user', content: prompt }];

    const response = await this.fetchJson(`${this.options.baseUrl}/chat/completions`, {
      model: this.options.model,
      messages,
      tools: openaiTools,
      tool_choice: 'auto',
      max_tokens: this.options.maxTokens,
      temperature: this.options.temperature,
    });

    const choices = response?.choices as Array<{ message?: { content?: string; tool_calls?: unknown[] } }> | undefined;
    const message = choices?.[0]?.message;
    if (!message) return '';

    // If the model returned a native tool call, serialize it back to JSON
    // so the ToolParser can handle it uniformly.
    if (message.tool_calls && Array.isArray(message.tool_calls)) {
      const calls = message.tool_calls.map((tc: unknown) => {
        const tcObj = tc as Record<string, unknown>;
        let args: Record<string, unknown> = {};
        const fn = tcObj.function as Record<string, unknown> | undefined;
        if (fn?.arguments && typeof fn.arguments === 'string') {
          try {
            args = JSON.parse(fn.arguments);
          } catch {
            args = {};
          }
        }
        return { name: fn?.name, arguments: args };
      });
      return JSON.stringify(calls);
    }

    return message.content ?? '';
  }

  // ---------------------------------------------------------------------------
  // Anthropic implementation
  // ---------------------------------------------------------------------------

  private async anthropicGenerate(prompt: string): Promise<string> {
    const body: Record<string, unknown> = {
      model: this.options.model,
      max_tokens: this.options.maxTokens,
      messages: [{ role: 'user', content: prompt }],
    };
    if (this.options.system) body.system = this.options.system;
    const response = await this.fetchJson(
      `${this.options.baseUrl}/messages`,
      body,
      {
        'x-api-key': this.options.apiKey,
        'anthropic-version': '2023-06-01',
      },
    );
    const content = response?.content as Array<Record<string, unknown>> | undefined;
    return (content?.[0]?.text as string | undefined) ?? '';
  }

  private async anthropicGenerateWithTools(prompt: string, tools: Tool[]): Promise<string> {
    const anthropicTools = tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: {
        type: t.parameters.type,
        properties: t.parameters.properties,
        required: t.parameters.required ?? [],
      },
    }));

    const anthropicBody: Record<string, unknown> = {
      model: this.options.model,
      max_tokens: this.options.maxTokens,
      tools: anthropicTools,
      messages: [{ role: 'user', content: prompt }],
    };
    if (this.options.system) anthropicBody.system = this.options.system;
    const response = await this.fetchJson(
      `${this.options.baseUrl}/messages`,
      anthropicBody,
      {
        'x-api-key': this.options.apiKey,
        'anthropic-version': '2023-06-01',
      },
    );

    // Anthropic returns tool_use blocks in the content array
    if (Array.isArray(response?.content)) {
      const toolBlocks = response.content.filter(
        (b: Record<string, unknown>) => b.type === 'tool_use',
      );
      if (toolBlocks.length > 0) {
        const calls = toolBlocks.map((b: Record<string, unknown>) => ({
          name: b.name,
          arguments: b.input ?? {},
        }));
        return JSON.stringify(calls);
      }

      // Text response
      const textBlock = response.content.find(
        (b: Record<string, unknown>) => b.type === 'text',
      );
      return textBlock?.text ?? '';
    }

    return '';
  }

  // ---------------------------------------------------------------------------
  // HTTP helper
  // ---------------------------------------------------------------------------

  private async fetchJson(
    url: string,
    body: unknown,
    extraHeaders: Record<string, string> = {},
  ): Promise<Record<string, unknown>> {
    const isAnthropic = this.options.apiFormat === 'anthropic';

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...extraHeaders,
    };

    if (!isAnthropic) {
      headers['Authorization'] = `Bearer ${this.options.apiKey}`;
    }

    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errorText = await res.text().catch(() => res.statusText);
      throw new Error(`CloudProvider API error ${res.status}: ${errorText}`);
    }

    return res.json() as Promise<Record<string, unknown>>;
  }
}
