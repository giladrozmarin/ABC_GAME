# Sandbox image for docker / daytona / e2b providers.
# Contains everything an agent needs to build software plus the Claude Code runtime.
# Credentials are NEVER baked in: the orchestrator injects a per-agent scoped key at runtime.
FROM node:22-bookworm

RUN apt-get update && apt-get install -y --no-install-recommends \
      git python3 python3-pip python3-venv build-essential curl ca-certificates jq ripgrep sqlite3 \
    && rm -rf /var/lib/apt/lists/*

RUN npm install -g @anthropic-ai/claude-code pnpm

# Unprivileged user; Claude Code refuses --dangerously-skip-permissions as root and we never use it anyway.
RUN useradd -m -s /bin/bash agent && mkdir -p /workspace && chown agent:agent /workspace
USER agent
WORKDIR /workspace
ENV PIP_BREAK_SYSTEM_PACKAGES=1 \
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1
RUN git config --global user.email agent@society.local && git config --global user.name society-agent && git config --global init.defaultBranch main
CMD ["sleep", "infinity"]
