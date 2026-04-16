// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type {
  AgentOptions,
  AgentEvent,
  AgentAction,
  ToolCall,
  Tool,
  ToolParameters,
  ToolProperty,
  LLMProviderInterface,
  UseAgentState,
  ChatMessage,
} from './types';

// ---------------------------------------------------------------------------
// Agent core
// ---------------------------------------------------------------------------

export { AgentLoop } from './agent/AgentLoop';
export { ScreenSerializer } from './agent/ScreenSerializer';
export { ToolParser } from './agent/ToolParser';

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

export { ToolRegistry } from './tools/ToolRegistry';
export { PHONE_TOOLS } from './tools/PhoneTools';

// ---------------------------------------------------------------------------
// Providers
// ---------------------------------------------------------------------------

export { LLMProvider } from './providers/LLMProvider';
export { GemmaProvider } from './providers/GemmaProvider';
export type { GemmaProviderOptions } from './providers/GemmaProvider';
export { CloudProvider } from './providers/CloudProvider';
export type { CloudProviderOptions } from './providers/CloudProvider';
export { FallbackProvider } from './providers/FallbackProvider';
export type { FallbackProviderOptions, ComplexityHeuristics } from './providers/FallbackProvider';

// ---------------------------------------------------------------------------
// React hooks
// ---------------------------------------------------------------------------

export { useAgent } from './hooks/useAgent';
export { useAgentChat } from './hooks/useAgentChat';
export type { UseAgentChatState } from './hooks/useAgentChat';
