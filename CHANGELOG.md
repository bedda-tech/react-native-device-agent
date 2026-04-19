# Changelog

All notable changes to `react-native-device-agent` are documented here.

This project follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] – 2026-04-19

Initial public release.

### Added

**Agent loop**
- `AgentLoop` – core observe → think → act loop with configurable max steps and settle delay
- `ScreenSerializer` – converts an accessibility tree into compact, LLM-readable text
- `ToolParser` – extracts tool calls from LLM output (XML tags, markdown blocks, bare JSON)
- `TaskPlanner` – decomposes high-level tasks into subtasks via LLM and runs each through AgentLoop

**Tools**
- `ToolRegistry` – register, lookup, and validate tool schemas at runtime
- `PhoneTools` – default tool set: `tap`, `type_text`, `swipe`, `scroll`, `open_app`,
  `read_screen`, `screenshot`, `global_action`, `wait`, `task_complete`
- `ToolSchema` – helpers to convert schemas to OpenAI / Anthropic / Gemma wire formats

**Providers**
- `LLMProvider` – abstract interface for LLM backends
- `GemmaProvider` – on-device Gemma 4 via `react-native-executorch`
- `CloudProvider` – OpenAI and Anthropic API fallback with system prompt support
- `FallbackProvider` – wraps Gemma + Cloud; routes complex tasks to cloud based on configurable heuristics
- `ScreenshotPreprocessor` – resize / crop / compress screenshots before multimodal inference

**React hooks**
- `useAgent` – lifecycle hook: `execute(task)`, `stop()`, `isRunning`, `history`
- `useAgentChat` – chat-style interface; converts `AgentEvent` stream into `ChatMessage[]`

**Types** – full TypeScript strict-mode types for all public APIs

### Testing

Unit tests for all pure-TypeScript modules: AgentLoop, ToolParser, ScreenSerializer,
ScreenshotPreprocessor, TaskPlanner, FallbackProvider, CloudProvider, PhoneTools, ToolSchema,
ToolRegistry.

[Unreleased]: https://github.com/bedda-tech/react-native-device-agent/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/bedda-tech/react-native-device-agent/releases/tag/v0.1.0
