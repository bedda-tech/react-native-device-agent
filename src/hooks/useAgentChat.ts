import { useCallback, useEffect, useRef, useState } from 'react';
import type { AgentOptions, ChatMessage } from '../types';
import { AgentLoop } from '../agent/AgentLoop';

/**
 * State returned by the useAgentChat hook.
 */
export interface UseAgentChatState {
  /** Whether the agent is currently running a task. */
  isRunning: boolean;
  /**
   * Chat-style conversation history.
   *
   * Each user command becomes a ChatMessage with role='user'.
   * Agent steps (thinking, actions, screen observations) are folded into a
   * streaming ChatMessage with role='agent' that updates as the loop runs.
   * Errors become ChatMessages with role='system'.
   */
  messages: ChatMessage[];
  /**
   * Submit a new user command to the agent.
   *
   * Returns a promise that resolves when the agent finishes the task.
   */
  sendMessage: (text: string) => Promise<void>;
  /** Abort the currently running agent task. */
  stop: () => void;
  /** Clear all messages from the conversation history. */
  clearMessages: () => void;
}

/**
 * React hook providing a chat-style interface over the agent loop.
 *
 * Unlike `useAgent` (which yields raw AgentEvents), `useAgentChat` presents
 * the session as a list of `ChatMessage` objects -- the same shape the Deft
 * chat UI renders directly.
 *
 * User commands become role='user' messages immediately. Agent steps stream
 * into a single role='agent' message that grows as actions are executed. When
 * the task completes, the agent message is finalized with the summary. On
 * error, a role='system' message is appended.
 *
 * @example
 * ```tsx
 * const { messages, isRunning, sendMessage, stop } = useAgentChat({
 *   provider: new GemmaProvider({ model: GEMMA4_E4B }),
 *   maxSteps: 20,
 * });
 *
 * // Render messages
 * messages.map((m) => <ChatBubble key={m.timestamp} message={m} />)
 *
 * // Send a command
 * await sendMessage('Open Settings and enable Wi-Fi');
 * ```
 */
export function useAgentChat(options: AgentOptions): UseAgentChatState {
  const [isRunning, setIsRunning] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const loopRef = useRef<AgentLoop | null>(null);

  // Refs keep options/isRunning accessible inside stable callbacks without
  // causing them to be recreated on every render.
  const optionsRef = useRef(options);
  useEffect(() => {
    optionsRef.current = options;
  });
  const isRunningRef = useRef(false);

  const appendMessage = useCallback((msg: ChatMessage) => {
    setMessages((prev) => [...prev, msg]);
  }, []);

  const updateLastAgentMessage = useCallback((content: string) => {
    setMessages((prev) => {
      const lastIdx = prev.length - 1;
      if (lastIdx >= 0 && prev[lastIdx].role === 'agent') {
        const updated = { ...prev[lastIdx], content };
        return [...prev.slice(0, lastIdx), updated];
      }
      const newMsg: ChatMessage = { role: 'agent', content, timestamp: Date.now() };
      return [...prev, newMsg];
    });
  }, []);

  const sendMessage = useCallback(async (text: string) => {
    if (isRunningRef.current) return;

    appendMessage({ role: 'user', content: text, timestamp: Date.now() });

    isRunningRef.current = true;
    setIsRunning(true);

    const loop = new AgentLoop(optionsRef.current);
    loopRef.current = loop;

    const lines: string[] = [];

    try {
      for await (const event of loop.run(text)) {
        switch (event.type) {
          case 'thinking':
            lines.push(`\u2026 ${event.content}`);
            updateLastAgentMessage(lines.join('\n'));
            break;

          case 'action':
            lines.push(`\u25b6 ${event.tool}(${formatArgs(event.args)})`);
            updateLastAgentMessage(lines.join('\n'));
            optionsRef.current.onAction?.({ tool: event.tool, args: event.args, timestamp: Date.now() });
            break;

          case 'observation':
            lines.push(`\u25a0 Step ${event.step}: observed screen`);
            updateLastAgentMessage(lines.join('\n'));
            break;

          case 'complete':
            updateLastAgentMessage(event.result);
            optionsRef.current.onComplete?.(event.result);
            break;

          case 'max_steps_reached':
            updateLastAgentMessage(
              lines.length > 0
                ? `${lines.join('\n')}\n\u26a0 Max steps reached without completing the task.`
                : 'Max steps reached without completing the task.',
            );
            break;

          case 'error':
            lines.push(`\u274c ${event.error.message}`);
            updateLastAgentMessage(lines.join('\n'));
            optionsRef.current.onError?.(event.error);
            break;
        }
      }
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      appendMessage({ role: 'system', content: `Agent error: ${error.message}`, timestamp: Date.now() });
      optionsRef.current.onError?.(error);
    } finally {
      isRunningRef.current = false;
      setIsRunning(false);
      loopRef.current = null;
    }
  }, [appendMessage, updateLastAgentMessage]);

  const stop = useCallback(() => {
    loopRef.current?.abort();
  }, []);

  const clearMessages = useCallback(() => {
    setMessages([]);
  }, []);

  return { isRunning, messages, sendMessage, stop, clearMessages };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Compact display format for tool arguments in the chat log.
 * Short values are shown inline; large objects are truncated.
 */
function formatArgs(args: Record<string, unknown>): string {
  const entries = Object.entries(args);
  if (entries.length === 0) return '';

  const parts = entries.map(([k, v]) => {
    const str = JSON.stringify(v);
    // Truncate long strings so the chat log stays readable
    return `${k}: ${str.length > 40 ? `${str.slice(0, 37)}...` : str}`;
  });

  return parts.join(', ');
}
