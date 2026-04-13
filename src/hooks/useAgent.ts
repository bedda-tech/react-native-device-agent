import { useCallback, useRef, useState } from 'react';
import type { AgentEvent, AgentOptions, UseAgentState } from '../types';
import { AgentLoop } from '../agent/AgentLoop';

/**
 * React hook for managing the agent lifecycle.
 *
 * @example
 * ```tsx
 * const { isRunning, history, execute, stop } = useAgent({
 *   provider: new GemmaProvider({ model: GEMMA4_E4B }),
 *   maxSteps: 20,
 *   settleMs: 500,
 *   onAction: (action) => console.log('Action:', action),
 *   onComplete: (result) => console.log('Done:', result),
 * });
 *
 * await execute('Open Settings and turn on Wi-Fi');
 * ```
 */
export function useAgent(options: AgentOptions): UseAgentState {
  const [isRunning, setIsRunning] = useState(false);
  const [history, setHistory] = useState<AgentEvent[]>([]);
  const loopRef = useRef<AgentLoop | null>(null);

  const execute = useCallback(
    async (task: string) => {
      setIsRunning(true);
      setHistory([]);

      const loop = new AgentLoop(options);
      loopRef.current = loop;

      try {
        for await (const event of loop.run(task)) {
          setHistory((prev) => [...prev, event]);

          if (event.type === 'action' && options.onAction) {
            options.onAction({
              tool: event.tool,
              args: event.args,
              timestamp: Date.now(),
            });
          }

          if (event.type === 'complete' && options.onComplete) {
            options.onComplete(event.result);
          }

          if (event.type === 'error' && options.onError) {
            options.onError(event.error);
          }
        }
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        setHistory((prev) => [...prev, { type: 'error', error: err }]);
        options.onError?.(err);
      } finally {
        setIsRunning(false);
        loopRef.current = null;
      }
    },
    [options],
  );

  const stop = useCallback(() => {
    loopRef.current?.abort();
  }, []);

  return { isRunning, history, execute, stop };
}
