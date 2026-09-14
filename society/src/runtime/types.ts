import type { Usage } from '../economy/pricing.js';

export interface RunSpec {
  runId: string;
  agentId: string;
  prompt: string;
  systemPrompt: string;
  model: string;
  effort: string;
  tools: string[];
  /** Resume this runtime session (memory continuity across wakes). */
  sessionId: string;
  isFirstRun: boolean;
  maxBudgetUsd: number;
  maxRunSec: number;
  /** JSON schema for structured final output (judging/voting runs). */
  jsonSchema?: Record<string, unknown>;
}

export interface RunCallbacks {
  onActivity?(kind: 'text' | 'tool' | 'thinking', detail: string): void;
  /** Incremental cost & usage as the run proceeds. Return false to kill the run (budget exhausted). */
  onUsage?(deltaUsd: number, usage: Usage, model: string): boolean | void;
  onToolCall?(name: string, input: unknown): void;
}

export interface RunResult {
  runId: string;
  costUsd: number;
  usage: Usage;
  exitReason: 'completed' | 'killed' | 'error' | 'timeout' | 'budget';
  finalText: string;
  structuredOutput?: unknown;
  turns: number;
  toolCalls: number;
  error?: string;
  transcriptPath: string | null;
}

export interface RunHandle { result: Promise<RunResult>; kill(reason: RunResult['exitReason']): Promise<void> }

export interface AgentRuntime {
  readonly name: string;
  start(spec: RunSpec, cb: RunCallbacks): Promise<RunHandle>;
}
