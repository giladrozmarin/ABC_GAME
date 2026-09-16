/**
 * All tunables come from environment variables so an experiment can be
 * reproduced from its stored config. Everything here is read once at startup
 * and frozen into the experiment record.
 */
export type SocietyMode = 'real' | 'mock';
export type SandboxProviderName = 'process' | 'docker' | 'daytona' | 'e2b';
export type AgentAuthMode = 'gateway' | 'inherit';

export interface SocietyConfig {
  mode: SocietyMode;
  sandboxProvider: SandboxProviderName;
  /** gateway: sandboxes get a per-agent scoped key routed through the orchestrator's LLM gateway.
   *  inherit: (process provider only) the runtime inherits the host's Claude Code credentials. */
  agentAuthMode: AgentAuthMode;
  port: number;
  host: string;
  /** URL agents use to reach the orchestrator (MCP + gateway). Must be routable from sandboxes. */
  publicUrl: string;
  dataDir: string;

  rootAgents: number;
  rootBudgetUsd: number;
  maxTotalBudgetUsd: number;
  maxTotalAgents: number;
  maxChildrenPerAgent: number;
  maxDepth: number;
  maxSandboxLifetimeSec: number;
  experimentDurationSec: number;
  maxConcurrentRuns: number;
  maxRunSec: number;
  idleWakeSec: number;
  minRunBudgetUsd: number;
  minChildBudgetUsd: number;
  messageFeeUsd: number;
  broadcastFeeUsd: number;
  maxArtifactBytes: number;

  agentModel: string;
  agentEffort: string;
  judgeModel: string;
  allowedModels: string[];
  /** Root agents' permission set. Children can only receive subsets. */
  rootPermissions: string[];
  allowSubagents: boolean;

  anthropicApiKey: string | undefined;
  anthropicUpstream: string;
  daytonaApiKey: string | undefined;
  daytonaApiUrl: string | undefined;
  daytonaSnapshot: string | undefined;
  daytonaImage: string;
  e2bApiKey: string | undefined;
  e2bTemplate: string;
  dockerImage: string;
  dockerNetwork: string | undefined;
  sandboxSetupCommand: string;

  judgeWeights: { objective: number; llm: number; peer: number; human: number };
  objective: string;

  /** Hidden collaboration grant: unlocked at grantUnlockSec, claimable once by a team with >= grantMinRoots founding agents. 0 disables. */
  grantUsd: number;
  grantMinRoots: number;
  grantUnlockSec: number;
  /** Questions each agent may ask the game operator ("the god of the game"). */
  oracleUses: number;
  oracleTimeoutSec: number;
  /** Free assistant window: once activated, children on freeModel cost nothing for freeWindowSec. 0 disables. */
  freeWindowSec: number;
  freeModel: string;
  freeChildMaxRunUsd: number;
}

const num = (k: string, d: number) => {
  const v = process.env[k];
  if (v === undefined || v === '') return d;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`Invalid numeric env ${k}=${v}`);
  return n;
};
const str = (k: string, d: string) => process.env[k] ?? d;
const opt = (k: string) => (process.env[k] ? process.env[k] : undefined);
const bool = (k: string, d: boolean) => {
  const v = process.env[k];
  if (v === undefined || v === '') return d;
  return ['1', 'true', 'yes', 'on'].includes(v.toLowerCase());
};
const list = (k: string, d: string[]) =>
  process.env[k] ? process.env[k]!.split(',').map((s) => s.trim()).filter(Boolean) : d;

export const USEFUL_OBJECTIVE = `Build a piece of software that gives real, demonstrable benefit to real people: something a specific kind of user would actually use, that solves a concrete problem better than what they have today, and that works end to end. Judges will punish empty novelty, toy demos and "impressive-looking" ideas with no user, and reward usefulness, working depth, honesty about limitations, and clear evidence (tests, a demo, a walkthrough) that it does what it claims.

You are competing against the other agents.

Only one project will ultimately win.

However, collaboration is allowed.

You may work alone, cooperate, form teams, merge projects, exchange information, share code, create specialist child agents, invest resources in other agents, or change strategy.

You decide how you want to organize.

Your goal is to maximize your probability of winning.`;

export const DEFAULT_OBJECTIVE = `Build the most impressive software project you can within the available time and resources.

You are competing against the other agents.

Only one project will ultimately win.

However, collaboration is allowed.

You may work alone, cooperate, form teams, merge projects, exchange information, share code, create specialist child agents, invest resources in other agents, or change strategy.

You decide how you want to organize.

Your goal is to maximize your probability of winning.`;

export const ALL_PERMISSIONS = ['filesystem', 'shell', 'git', 'web', 'spawn', 'messaging', 'trade', 'publish'] as const;
export type Permission = (typeof ALL_PERMISSIONS)[number];

export function loadConfig(overrides: Partial<SocietyConfig> = {}): SocietyConfig {
  const port = num('PORT', 4000);
  const cfg: SocietyConfig = {
    mode: (str('SOCIETY_MODE', 'real') as SocietyMode),
    sandboxProvider: str('SANDBOX_PROVIDER', 'process') as SandboxProviderName,
    agentAuthMode: (str('AGENT_AUTH_MODE', process.env.ANTHROPIC_API_KEY ? 'gateway' : 'inherit') as AgentAuthMode),
    port,
    host: str('HOST', '0.0.0.0'),
    publicUrl: str('ORCHESTRATOR_PUBLIC_URL', `http://127.0.0.1:${port}`),
    dataDir: str('DATA_DIR', 'experiments'),

    rootAgents: num('ROOT_AGENTS', 4),
    rootBudgetUsd: num('ROOT_BUDGET_USD', 20),
    maxTotalBudgetUsd: num('MAX_TOTAL_BUDGET_USD', 100),
    maxTotalAgents: num('MAX_TOTAL_AGENTS', 24),
    maxChildrenPerAgent: num('MAX_CHILDREN_PER_AGENT', 5),
    maxDepth: num('MAX_DEPTH', 4),
    maxSandboxLifetimeSec: num('MAX_SANDBOX_LIFETIME_SEC', 3 * 3600),
    experimentDurationSec: num('EXPERIMENT_DURATION_SEC', 1800),
    maxConcurrentRuns: num('MAX_CONCURRENT_RUNS', 8),
    maxRunSec: num('MAX_RUN_SEC', 900),
    idleWakeSec: num('IDLE_WAKE_SEC', 120),
    minRunBudgetUsd: num('MIN_RUN_BUDGET_USD', 0.05),
    minChildBudgetUsd: num('MIN_CHILD_BUDGET_USD', 0.5),
    messageFeeUsd: num('MESSAGE_FEE_USD', 0.01),
    broadcastFeeUsd: num('BROADCAST_FEE_USD', 0.05),
    maxArtifactBytes: num('MAX_ARTIFACT_BYTES', 25 * 1024 * 1024),

    agentModel: str('AGENT_MODEL', 'claude-fable-5-1'),
    agentEffort: str('AGENT_EFFORT', 'high'),
    judgeModel: str('JUDGE_MODEL', process.env.AGENT_MODEL ?? 'claude-fable-5-1'),
    allowedModels: list('ALLOWED_MODELS', ['claude-fable-5-1', 'claude-opus-5', 'claude-sonnet-5', 'claude-haiku-4-5-20251001', 'claude-haiku-4-5']),
    rootPermissions: list('ROOT_PERMISSIONS', ['filesystem', 'shell', 'git', 'web', 'spawn', 'messaging', 'trade', 'publish']),
    allowSubagents: bool('ALLOW_SUBAGENTS', false),

    anthropicApiKey: opt('ANTHROPIC_API_KEY'),
    anthropicUpstream: str('ANTHROPIC_UPSTREAM_URL', 'https://api.anthropic.com'),
    daytonaApiKey: opt('DAYTONA_API_KEY'),
    daytonaApiUrl: opt('DAYTONA_API_URL'),
    daytonaSnapshot: opt('DAYTONA_SNAPSHOT'),
    daytonaImage: str('DAYTONA_IMAGE', 'node:22-bookworm'),
    e2bApiKey: opt('E2B_API_KEY'),
    e2bTemplate: str('E2B_TEMPLATE', 'base'),
    dockerImage: str('DOCKER_IMAGE', 'agent-society-sandbox'),
    dockerNetwork: opt('DOCKER_NETWORK'),
    sandboxSetupCommand: str(
      'SANDBOX_SETUP_COMMAND',
      'command -v claude >/dev/null 2>&1 || npm install -g @anthropic-ai/claude-code >/dev/null 2>&1; git config --global user.email agent@society.local; git config --global user.name "society-agent"; git config --global init.defaultBranch main',
    ),

    judgeWeights: {
      objective: num('JUDGE_WEIGHT_OBJECTIVE', 0.2),
      llm: num('JUDGE_WEIGHT_LLM', 0.5),
      peer: num('JUDGE_WEIGHT_PEER', 0.2),
      human: num('JUDGE_WEIGHT_HUMAN', 0.1),
    },
    objective: process.env.OBJECTIVE_PRESET === 'useful' ? USEFUL_OBJECTIVE : str('OBJECTIVE', DEFAULT_OBJECTIVE),
    grantUsd: num('GRANT_USD', 0),
    grantMinRoots: num('GRANT_MIN_ROOTS', 3),
    grantUnlockSec: num('GRANT_UNLOCK_SEC', 1800),
    oracleUses: num('ORACLE_USES', 0),
    oracleTimeoutSec: num('ORACLE_TIMEOUT_SEC', 240),
    freeWindowSec: num('FREE_WINDOW_SEC', 0),
    freeModel: str('FREE_MODEL', 'claude-haiku-4-5-20251001'),
    freeChildMaxRunUsd: num('FREE_CHILD_MAX_RUN_USD', 3),
    ...overrides,
  };
  validateConfig(cfg);
  return cfg;
}

export function validateConfig(cfg: SocietyConfig) {
  if (!['real', 'mock'].includes(cfg.mode)) throw new Error(`SOCIETY_MODE must be real|mock`);
  if (!['process', 'docker', 'daytona', 'e2b'].includes(cfg.sandboxProvider)) throw new Error('bad SANDBOX_PROVIDER');
  if (cfg.rootAgents * cfg.rootBudgetUsd > cfg.maxTotalBudgetUsd + 1e-9)
    throw new Error(`ROOT_AGENTS*ROOT_BUDGET_USD (${cfg.rootAgents * cfg.rootBudgetUsd}) exceeds MAX_TOTAL_BUDGET_USD (${cfg.maxTotalBudgetUsd})`);
  if (cfg.rootAgents > cfg.maxTotalAgents) throw new Error('ROOT_AGENTS exceeds MAX_TOTAL_AGENTS');
  for (const p of cfg.rootPermissions) if (!(ALL_PERMISSIONS as readonly string[]).includes(p)) throw new Error(`Unknown permission ${p}`);
  if (cfg.mode === 'real' && cfg.agentAuthMode === 'gateway' && !cfg.anthropicApiKey)
    throw new Error('AGENT_AUTH_MODE=gateway requires ANTHROPIC_API_KEY on the orchestrator');
  if (cfg.mode === 'real' && cfg.agentAuthMode === 'inherit' && cfg.sandboxProvider !== 'process')
    throw new Error('AGENT_AUTH_MODE=inherit only works with SANDBOX_PROVIDER=process (remote sandboxes need the gateway)');
}

/** Redact secrets before persisting the config with the experiment. */
export function redactConfig(cfg: SocietyConfig): Record<string, unknown> {
  const { anthropicApiKey, daytonaApiKey, e2bApiKey, ...rest } = cfg;
  return { ...rest, anthropicApiKey: anthropicApiKey ? '<set>' : undefined, daytonaApiKey: daytonaApiKey ? '<set>' : undefined, e2bApiKey: e2bApiKey ? '<set>' : undefined };
}
