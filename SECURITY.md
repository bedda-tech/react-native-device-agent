# Security Policy

## Supported Versions

We actively maintain security fixes for the latest release. Older versions do not receive backported patches.

| Version | Supported |
| ------- | --------- |
| latest  | ✓         |

## Reporting a Vulnerability

If you discover a security vulnerability in `react-native-device-agent`, **please do not open a public GitHub issue.**

Instead, email **security@bedda.tech** with:

- A description of the vulnerability and its potential impact
- Steps to reproduce (proof-of-concept code is welcome)
- The versions you have tested against

We will acknowledge your report within **48 hours** and aim to release a fix within **14 days** of confirmation.

We do not currently offer a bug bounty program, but we will credit researchers in the release notes unless they request anonymity.

## Security Considerations

`react-native-device-agent` implements an autonomous agent loop that reads the device screen and executes actions. Integrators must consider:

- **Prompt injection**: screen content ingested by the agent may contain adversarial instructions embedded by malicious apps or web pages. Do not allow the agent to act on screen content that originates from untrusted sources without a confirmation step.
- **Privilege escalation**: the agent inherits all permissions of the host app. Follow the principle of least privilege — only request the accessibility and overlay permissions your use case actually requires.
- **Unbounded loops**: configure `maxSteps` to a reasonable ceiling (default 20) to prevent run-away agent execution that could perform unintended actions.
- **Cloud API key exposure**: when using `CloudProvider`, treat the API key as a secret. Do not hard-code it in source code or bundle it in production builds; load it from secure storage at runtime.
- **Tool surface area**: every tool registered in `ToolRegistry` expands what the agent can do. Audit your tool set and remove any tools the agent does not need for its intended task.
