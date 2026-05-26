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

- **Pluggable LLM providers** -- on-device (Gemma 4 via ExecuTorch) or cloud (OpenAI, Anthropic) fallback
- **24 built-in phone tools** -- tap, type, swipe, scroll, find nodes, clipboard, session notes, and more
- **Custom tools** -- register your own tools with the ToolRegistry
- **React hooks** -- `useAgent` for easy integration into React Native apps
- **Streaming events** -- async generator yields every action, observation, and completion
- **Configurable** -- max steps, settle time, callbacks for actions and completion

## Installation

```bash
npm install react-native-device-agent react-native-accessibility-controller
# or
yarn add react-native-device-agent react-native-accessibility-controller
```

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
// On-device
const gemma = new GemmaProvider({ model: 'GEMMA4_E4B', maxTokens: 512 });

// Cloud
const cloud = new CloudProvider({ apiKey: '...', model: 'claude-sonnet-4-6' });
```

### useAgent Hook

```typescript
const { isRunning, history, execute, stop } = useAgent(options);
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
