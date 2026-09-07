# react-native-device-agent

[![MIT License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![npm version](https://img.shields.io/npm/v/react-native-device-agent.svg)](https://www.npmjs.com/package/react-native-device-agent)
[![build](https://img.shields.io/github/actions/workflow/status/bedda-tech/react-native-device-agent/ci.yml?branch=main)](https://github.com/bedda-tech/react-native-device-agent/actions)

**Agent orchestration loop for on-device AI phone control.** Connects LLM reasoning to phone actions via accessibility APIs. Observe the screen, think, act, repeat -- all on-device.

Part of the [Deft](https://github.com/bedda-tech/deft) ecosystem: an open-source, fully on-device AI phone agent.

---

## Architecture

```
 User Input (voice/text)
         |
         v
 +-------------------+
 |    AgentLoop       |   observe -> think -> act -> repeat
 +-------------------+
    |         |         |
    v         v         v
 readScreen  LLM     executeAction
    |      inference     |
    v         |         v
 ScreenSerializer     ToolRegistry
    |         |         |
    v         v         v
 +-------------------------------------------+
 |  react-native-accessibility-controller     |
 |  (screen tree, gestures, global actions)   |
 +-------------------------------------------+
              |
              v
        Any app on screen
```

### Agent Loop

The core loop follows a simple cycle:

1. **Observe** -- read the current screen via the accessibility tree
2. **Think** -- send the screen state + task to the LLM
3. **Act** -- parse tool calls from the LLM response and execute them
4. **Repeat** -- observe the new screen state and continue

The loop terminates when the LLM calls `task_complete` or the step limit is reached.

## Features

- **Pluggable LLM providers** -- on-device (Gemma 4 via ExecuTorch), cloud (OpenAI, Anthropic, OpenRouter), or hybrid dual-model
- **25 built-in phone tools** -- tap, type, swipe, scroll, find nodes, clipboard, session notes, and more
- **Dual-model inference** -- `DualModelProvider` routes planning to Gemma 4 E4B and tool dispatch to FunctionGemma 270M for lower per-step latency
- **Custom tools** -- register your own tools with the ToolRegistry or the fluent `ToolBuilder` API
- **React hooks** -- `useAgent`, `useAgentChat`, `useAgentMetrics`, `useTaskPlanner`, `useTaskQueue`
- **Streaming events** -- async generator yields every action, observation, and completion
- **Configurable** -- max steps, settle time, retry-on-error, callbacks for actions and completion

## Installation

```bash
npm install react-native-device-agent react-native-accessibility-controller
# or
yarn add react-native-device-agent react-native-accessibility-controller
```

> **Note:** Packages are in development. Install directly from GitHub if npm fails:
> ```bash
> npm install github:bedda-tech/react-native-device-agent github:bedda-tech/react-native-accessibility-controller
> ```

### Requirements

- React Native >= 0.76 (New Architecture)
- `react-native-accessibility-controller` as a peer dependency
- For on-device inference: `react-native-executorch` with Gemma 4

## Quick Start

```typescript
import { useAgent, GemmaProvider } from 'react-native-device-agent';

function AgentScreen() {
  const { isRunning, history, execute, stop } = useAgent({
    provider: new GemmaProvider({ model: 'GEMMA4_E4B' }),
    maxSteps: 20,
    settleMs: 500,
    onAction: (action) => console.log('Action:', action),
    onComplete: (result) => console.log('Done:', result),
  });

  return (
    <Button
      title={isRunning ? 'Stop' : 'Run'}
      onPress={() =>
        isRunning ? stop() : execute('Open Settings and turn on Wi-Fi')
      }
    />
  );
}
```

### Cloud Fallback

```typescript
import { useAgent, CloudProvider } from 'react-native-device-agent';

const { execute } = useAgent({
  provider: new CloudProvider({
    apiKey: 'sk-...',
    model: 'claude-sonnet-4-6',
  }),
});
```

### Dual-Model Setup (lower per-step latency)

Pair FunctionGemma 270M (fast tool dispatch) with Gemma 4 E4B (full reasoning) to reduce per-step latency on devices with ≥ 5–6 GB RAM.

```typescript
import {
  useAgent,
  DualModelProvider,
  FunctionGemmaProvider,
  GemmaProvider,
  PHONE_TOOL_PRESETS,
} from 'react-native-device-agent';
import { useLLM, GEMMA4_E4B, FUNCTION_GEMMA_270M } from 'react-native-executorch';

function AgentScreen() {
  const { generate: reasoningGen } = useLLM({ model: GEMMA4_E4B });
  const { generate: dispatchGen } = useLLM({ model: FUNCTION_GEMMA_270M });

  const { execute, isRunning } = useAgent({
    provider: new DualModelProvider({
      reasoningProvider: new GemmaProvider({ model: 'GEMMA4_E4B', generateFn: reasoningGen }),
      dispatchProvider: new FunctionGemmaProvider({ generateFn: dispatchGen }),
      dispatchToolFilter: PHONE_TOOL_PRESETS.DISPATCH,
    }),
    maxSteps: 20,
  });

  return <Button title="Run" onPress={() => execute('Send a message to Alice')} />;
}
```

## Built-in Tools

**Touch & Input**

| Tool | Description |
|------|-------------|
| `tap` | Tap a UI element by node ID or coordinates |
| `long_press` | Long press a UI element by node ID or coordinates |
| `type_text` | Type text into a focused input field |
| `clear_text` | Clear text from an input field |
| `press_enter` | Press the Enter key on a focused input |
| `swipe` | Swipe between two screen coordinates |
| `scroll` | Scroll a scrollable element up, down, left, or right |
| `set_checked` | Toggle a checkbox or switch to a desired checked state |

**Navigation & Apps**

| Tool | Description |
|------|-------------|
| `open_app` | Open an app by package name |
| `list_apps` | List all installed apps and their package names |
| `global_action` | System actions (home, back, recents, notifications, etc.) |

**Screen Reading**

| Tool | Description |
|------|-------------|
| `read_screen` | Capture current screen state as structured text |
| `screenshot` | Take a screenshot for visual analysis |
| `find_node` | Search the tree for a node by text, description, or class |
| `find_all_nodes` | Find all nodes matching a query |
| `get_node_text` | Read the text or content description of a specific node |
| `get_bounds` | Get the screen coordinates of a node |

**Waiting & Timing**

| Tool | Description |
|------|-------------|
| `wait` | Wait a specified number of milliseconds |
| `scroll_until_found` | Scroll a container repeatedly until a matching node appears |
| `wait_for_node` | Wait until a matching node appears in the tree |
| `wait_for_change` | Wait until the screen state changes |

**Session Memory**

| Tool | Description |
|------|-------------|
| `write_note` | Store a key-value note for use later in the session |
| `read_note` | Retrieve a previously stored note |

**Task Control**

| Tool | Description |
|------|-------------|
| `task_complete` | Signal the task is done with a summary |
| `task_failed` | Signal that the task cannot be completed, with a reason |

## Custom Tools

```typescript
import { ToolRegistry } from 'react-native-device-agent';

const registry = new ToolRegistry();

registry.register(
  {
    name: 'send_notification',
    description: 'Show a local notification',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Notification title' },
        body: { type: 'string', description: 'Notification body' },
      },
      required: ['title', 'body'],
    },
  },
  async (args) => {
    // Your notification logic here
  },
);
```

## API Reference

### AgentLoop

```typescript
const loop = new AgentLoop(options);

for await (const event of loop.run('Open Settings')) {
  // event.type: 'action' | 'observation' | 'thinking' | 'complete' | 'error' | 'max_steps_reached'
}

loop.abort(); // Stop the loop
```

### Providers

```typescript
// On-device (Gemma 4 E4B via ExecuTorch)
const gemma = new GemmaProvider({ model: 'GEMMA4_E4B', generateFn: generate });

// Cloud (OpenAI / Anthropic / OpenRouter)
const cloud = new CloudProvider({ apiKey: 'sk-...', model: 'claude-sonnet-4-6' });

// Hybrid: on-device first, cloud fallback on failure
const fallback = new FallbackProvider(gemma, cloud);

// Dual-model: FunctionGemma 270M for dispatch, Gemma 4 E4B for reasoning/vision
const dual = new DualModelProvider({
  reasoningProvider: new GemmaProvider({ model: 'GEMMA4_E4B', generateFn: reasoningGen }),
  loadDispatchProvider: async () =>
    new FunctionGemmaProvider({ generateFn: dispatchGen }),
  dispatchToolFilter: PHONE_TOOL_PRESETS.DISPATCH, // compact tool list for 270M
  debug: false,
});

// DualModelProvider.isDispatchReady — true once FunctionGemma has been loaded
console.log(dual.isDispatchReady);
```

`DualModelProvider` routing table:

| Method | Routed to | Reason |
|--------|-----------|--------|
| `generateWithTools` | dispatchProvider | FunctionGemma 270M is specialised for tool dispatch |
| `generate` | reasoningProvider | Planning / free-form text needs full model |
| `generateWithVision` | reasoningProvider | Vision grounding needs full model |

If the dispatch provider throws, `generateWithTools` falls back to the reasoning provider transparently.

### Hooks

```typescript
// Run the agent and manage its lifecycle
const { isRunning, history, execute, stop } = useAgent(options);

// Chat-style interface: each event becomes a ChatMessage
const { messages, isRunning, execute, stop } = useAgentChat(options);

// Live performance metrics derived from the history array
const metrics = useAgentMetrics(history, isRunning);
// metrics: { stepCount, actionCount, elapsedMs, averageStepMs, outcome }

// Multi-step task decomposition via TaskPlanner
const { isRunning, plan, currentSubtask, results, execute, stop } = useTaskPlanner(options);

// Sequential task queue — runs tasks one after another
const { queue, isRunning, currentTask, enqueue, clearQueue, stop } = useTaskQueue(options);
```

## Deft Ecosystem

| Package | Description |
|---------|-------------|
| [react-native-accessibility-controller](https://github.com/bedda-tech/react-native-accessibility-controller) | Android AccessibilityService for React Native |
| [react-native-device-agent](https://github.com/bedda-tech/react-native-device-agent) | Agent loop connecting LLM to phone control (this repo) |
| [react-native-executorch](https://github.com/bedda-tech/react-native-executorch) | On-device LLM inference (Gemma 4) via ExecuTorch |
| [deft](https://github.com/bedda-tech/deft) | The consumer app combining all three |

## Contributing

Contributions are welcome. This is the orchestration layer -- improvements to the agent loop, new built-in tools, and better provider abstractions are all good targets.

**Setup**

```bash
git clone https://github.com/bedda-tech/react-native-device-agent.git
cd react-native-device-agent
npm install
npm run typecheck
```

**Guidelines**

- All code is TypeScript strict -- `npm run typecheck` must exit 0
- New tools must implement the `Tool` interface and be registered via `ToolRegistry`
- New providers must implement the `LLMProvider` interface
- The `AgentLoop` observe/think/act contract must not change in a backwards-incompatible way
- Add a `useAgent` option for any new loop configuration
- Open an issue before starting large changes

## License

MIT
