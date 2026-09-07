# Taste (Continuously Learned by [CommandCode][cmd])

[cmd]: https://commandcode.ai/

# workflow
See [workflow/taste.md](workflow/taste.md)
# communication
- Report task results briefly and state follow-ups; if there are none, do not explicitly say so. Confidence: 0.8
- Use feature flags (CHM_FEATURE_* env vars) to gate new capabilities behind env checks. Confidence: 0.75

# naming
- Use CHM_ prefix for environment variable names and KV namespace names. Confidence: 0.70

# tooling
- Use pnpm as the package manager. Confidence: 0.75
- Use bun for running tests. Confidence: 0.70

