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
   * Each user command becomes a 'text' ChatMessage with role='user'.
   * Agent tool calls become individual 'action' messages (green dot when done).
   * Screen observations become 'screen' dividers between steps.
   * Task completion becomes a 'text' bubble with the summary.
   * Errors become 'text' messages with role='system'.
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
 * the session as a list of typed `ChatMessage` objects:
 *
 *   - User commands      → role='user',   kind='text'   (chat bubble)
 *   - Agent tool calls   → role='agent',  kind='action' (bullet with dot)
 *   - Screen observations→ role='agent',  kind='screen' (divider)
 *   - Task complete      → role='agent',  kind='text'   (chat bubble)
 *   - Errors             → role='system', kind='text'
 *
 * The `pending` flag on 'action' messages is true while the loop is still
 * running (grey dot) and false once the agent has moved past that step
 * (green dot).
 *
 * @example
 * ```tsx
 * const { messages, isRunning, sendMessage, stop } = useAgentChat({
 *   provider: new GemmaProvider({ model: GEMMA4_E4B }),
 *   maxSteps: 20,
 * });
 *
 * messages.map((m) => <ChatBubble key={m.timestamp} message={m} />)
 * await sendMessage('Open Settings and enable Wi-Fi');
 * ```
 */
export function useAgentChat(options: AgentOptions): UseAgentChatState {
  const [isRunning, setIsRunning] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const loopRef = useRef<AgentLoop | null>(null);

  const optionsRef = useRef(options);
  useEffect(() => {
    optionsRef.current = options;
  });
  const isRunningRef = useRef(false);

  const appendMessage = useCallback((msg: ChatMessage) => {
    setMessages((prev) => [...prev, msg]);
  }, []);

  // Mark the most recent 'action' message as no longer pending.
  const resolveLastAction = useCallback(() => {
    setMessages((prev) => {
      for (let i = prev.length - 1; i >= 0; i--) {
        if (prev[i].kind === 'action' && prev[i].pending) {
          const updated = { ...prev[i], pending: false };
          return [...prev.slice(0, i), updated, ...prev.slice(i + 1)];
        }
      }
      return prev;
    });
  }, []);

  const sendMessage = useCallback(async (text: string) => {
    if (isRunningRef.current) return;

    appendMessage({ role: 'user', text, kind: 'text', timestamp: Date.now() });

    isRunningRef.current = true;
    setIsRunning(true);

    const loop = new AgentLoop(optionsRef.current);
    loopRef.current = loop;

    try {
      for await (const event of loop.run(text)) {
        switch (event.type) {
          case 'thinking':
            // Thinking is internal — no visual message; callers can use onAction.
            break;

          case 'action':
            // Resolve the previous pending action (if any) before adding the new one.
            resolveLastAction();
            appendMessage({
              role: 'agent',
              text: `${event.tool}(${formatArgs(event.args)})`,
              kind: 'action',
              pending: true,
              timestamp: Date.now(),
            });
            optionsRef.current.onAction?.({
              tool: event.tool,
              args: event.args,
              timestamp: Date.now(),
            });
            break;

          case 'observation':
            resolveLastAction();
            appendMessage({
              role: 'agent',
              text: `Step ${event.step}`,
              kind: 'screen',
              timestamp: Date.now(),
            });
            break;

          case 'complete':
            resolveLastAction();
            appendMessage({
              role: 'agent',
              text: event.result,
              kind: 'text',
              timestamp: Date.now(),
            });
            optionsRef.current.onComplete?.(event.result);
            break;

          case 'max_steps_reached':
            resolveLastAction();
            appendMessage({
              role: 'system',
              text: 'Max steps reached without completing the task.',
              kind: 'text',
              timestamp: Date.now(),
            });
            break;

          case 'error':
            resolveLastAction();
            appendMessage({
              role: 'system',
              text: `Agent error: ${event.error.message}`,
              kind: 'text',
              timestamp: Date.now(),
            });
            optionsRef.current.onError?.(event.error);
            break;
        }
      }
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      resolveLastAction();
      appendMessage({
        role: 'system',
        text: `Agent error: ${error.message}`,
        kind: 'text',
        timestamp: Date.now(),
      });
      optionsRef.current.onError?.(error);
    } finally {
      isRunningRef.current = false;
      setIsRunning(false);
      loopRef.current = null;
    }
  }, [appendMessage, resolveLastAction]);

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

function formatArgs(args: Record<string, unknown>): string {
  const entries = Object.entries(args);
  if (entries.length === 0) return '';

  const parts = entries.map(([k, v]) => {
    const str = JSON.stringify(v);
    return `${k}: ${str.length > 40 ? `${str.slice(0, 37)}...` : str}`;
  });

  return parts.join(', ');
}
