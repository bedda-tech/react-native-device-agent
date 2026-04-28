import type { Tool } from '../types';
import { LLMProvider } from './LLMProvider';
import { toOpenAIFunction, toAnthropicTool } from '../tools/ToolSchema';

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
   * - 'openrouter': OpenRouter — OpenAI-compatible but uses openrouter.ai base
   *   URL and requires an HTTP-Referer header for rate-limit attribution.
   */
  apiFormat?: 'openai' | 'anthropic' | 'openrouter';
  /**
   * HTTP-Referer header value sent with OpenRouter requests.
   * Required for rate-limit attribution; typically your app's GitHub URL.
   * Only used when apiFormat is 'openrouter'.
   */
  referer?: string;
  /**
   * Optional system prompt injected into every API request.
   *
   * For Anthropic this maps to the top-level `system` field (recommended).
   * For OpenAI/OpenRouter it is prepended as a `role: 'system'` message.
   * Leave unset to use the model's default behaviour.
   */
  system?: string;
}

export class CloudProvider extends LLMProvider {
  private options: Required<Omit<CloudProviderOptions, 'system' | 'referer'>> & {
    system: string | undefined;
    referer: string | undefined;
  };

  constructor(options: CloudProviderOptions) {
    super();
    const format = options.apiFormat ?? 'openai';
    // OpenRouter uses the OpenAI-compatible API but at a different base URL.
    const defaultBaseUrl =
      format === 'anthropic'
        ? 'https://api.anthropic.com/v1'
        : format === 'openrouter'
          ? 'https://openrouter.ai/api/v1'
          : 'https://api.openai.com/v1';
    this.options = {
      baseUrl: defaultBaseUrl,
      maxTokens: 1024,
      temperature: 0.7,
      apiFormat: format,
      system: undefined,
      referer: undefined,
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
   *
   * OpenRouter uses the OpenAI-compatible path automatically.
   */
  async generateWithTools(prompt: string, tools: Tool[]): Promise<string> {
    return this.options.apiFormat === 'anthropic'
      ? this.anthropicGenerateWithTools(prompt, tools)
      : this.openaiGenerateWithTools(prompt, tools);
  }

  /**
   * Generate a response with tool-calling support and a screenshot image.
   *
   * Reads the image from `imagePath` (a local file path, possibly with a
   * `file://` prefix), encodes it as base64, and injects it into the API
   * request using the provider's native vision format.
   *
   * Falls back to `generateWithTools` if the image cannot be read.
   */
  async generateWithVision(prompt: string, tools: Tool[], imagePath: string): Promise<string> {
    try {
      const { data: imageBase64, mimeType } = await this.readImageAsBase64(imagePath);
      return this.options.apiFormat === 'anthropic'
        ? this.anthropicGenerateWithVision(prompt, tools, imageBase64, mimeType)
        : this.openaiGenerateWithVision(prompt, tools, imageBase64, mimeType);
    } catch {
      return this.generateWithTools(prompt, tools);
    }
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
  // Vision implementations
  // ---------------------------------------------------------------------------

  private async openaiGenerateWithVision(
    prompt: string,
    tools: Tool[],
    imageBase64: string,
    mimeType: string,
  ): Promise<string> {
    const openaiTools = tools.map(toOpenAIFunction);
    const messages: unknown[] = [
      ...(this.options.system ? [{ role: 'system', content: this.options.system }] : []),
      {
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: `data:${mimeType};base64,${imageBase64}` } },
          { type: 'text', text: prompt },
        ],
      },
    ];

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

    if (message.tool_calls && Array.isArray(message.tool_calls)) {
      const calls = message.tool_calls.map((tc: unknown) => {
        const tcObj = tc as Record<string, unknown>;
        let args: Record<string, unknown> = {};
        const fn = tcObj.function as Record<string, unknown> | undefined;
        if (fn?.arguments && typeof fn.arguments === 'string') {
          try { args = JSON.parse(fn.arguments); } catch { args = {}; }
        }
        return { name: fn?.name, arguments: args };
      });
      return JSON.stringify(calls);
    }

    return message.content ?? '';
  }

  private async anthropicGenerateWithVision(
    prompt: string,
    tools: Tool[],
    imageBase64: string,
    mimeType: string,
  ): Promise<string> {
    const anthropicTools = tools.map(toAnthropicTool);
    const body: Record<string, unknown> = {
      model: this.options.model,
      max_tokens: this.options.maxTokens,
      tools: anthropicTools,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mimeType, data: imageBase64 } },
            { type: 'text', text: prompt },
          ],
        },
      ],
    };
    if (this.options.system) body.system = this.options.system;

    const response = await this.fetchJson(
      `${this.options.baseUrl}/messages`,
      body,
      { 'x-api-key': this.options.apiKey, 'anthropic-version': '2023-06-01' },
    );

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
      const textBlock = response.content.find(
        (b: Record<string, unknown>) => b.type === 'text',
      );
      return (textBlock as Record<string, unknown> | undefined)?.text as string ?? '';
    }

    return '';
  }

  /**
   * Read a local image file and return it as a base64 string.
   * Accepts both plain paths and `file://` URIs.
   */
  private async readImageAsBase64(
    imagePath: string,
  ): Promise<{ data: string; mimeType: string }> {
    const fileUri = imagePath.startsWith('file://') ? imagePath : `file://${imagePath}`;
    const lower = imagePath.toLowerCase();
    const mimeType = lower.endsWith('.jpg') || lower.endsWith('.jpeg') ? 'image/jpeg' : 'image/png';

    const response = await fetch(fileUri);
    if (!response.ok) throw new Error(`readImageAsBase64: HTTP ${response.status}`);
    const blob = await response.blob();

    return new Promise<{ data: string; mimeType: string }>((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const dataUrl = reader.result as string;
        const base64 = dataUrl.split(',')[1];
        if (!base64) { reject(new Error('readImageAsBase64: no base64 data')); return; }
        resolve({ data: base64, mimeType });
      };
      reader.onerror = () => reject(reader.error ?? new Error('FileReader error'));
      reader.readAsDataURL(blob);
    });
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
    const isOpenRouter = this.options.apiFormat === 'openrouter';

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...extraHeaders,
    };

    if (!isAnthropic) {
      headers['Authorization'] = `Bearer ${this.options.apiKey}`;
    }

    if (isOpenRouter && this.options.referer) {
      headers['HTTP-Referer'] = this.options.referer;
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
