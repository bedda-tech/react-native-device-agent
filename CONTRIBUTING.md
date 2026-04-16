# Contributing to react-native-device-agent

`react-native-device-agent` is the agent loop that connects an on-device LLM to phone controls. It provides the observe/think/act loop, tool execution, LLM provider abstractions, and React hooks for building agent-powered UIs.

Contributions of all kinds are welcome.

## Ways to Contribute

- **Report bugs** — open a GitHub issue with a minimal reproduction
- **Request features** — open a GitHub issue describing what you need and why
- **Fix issues** — look for `good first issue` labels to find beginner-friendly tasks
- **Add tools** — new `Tool` implementations that agents can use
- **Add LLM providers** — new `LLMProvider` implementations
- **Improve docs** — fix typos, add examples, clarify API contracts

## Community

- [Discord](https://discord.gg/deft) — chat with maintainers and contributors
- [GitHub Discussions](https://github.com/bedda-tech/react-native-device-agent/discussions) — design proposals and Q&A

## Development Setup

Requirements:
- Node.js 20+, npm

```bash
git clone https://github.com/bedda-tech/react-native-device-agent.git
cd react-native-device-agent
npm install
npm run typecheck
```

## Code Guidelines

- All code is TypeScript strict — `npm run typecheck` must exit 0 with no output
- New tools must implement the `Tool` interface and be registered via `ToolRegistry`
- New providers must implement the `LLMProvider` interface
- The `AgentLoop` observe/think/act contract must not change in a backwards-incompatible way — add new behavior via options rather than altering existing signatures
- New loop configuration options must be exposed via the `useAgent` options object

## Pull Request Process

1. Fork the repo and create a branch from `main`:
   ```bash
   git checkout -b feat/issue-123-describe-your-change
   ```
2. Make your changes
3. Run `npm run typecheck` — must exit 0
4. Push and open a PR against `main`
5. Describe what changed and why; link the related issue

Please open an issue before starting large features or API changes to align on design before writing code.

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](./LICENSE).
