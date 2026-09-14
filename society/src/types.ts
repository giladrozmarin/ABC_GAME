import type { Permission } from './config.js';

export type AgentStatus = 'provisioning' | 'idle' | 'running' | 'exhausted' | 'terminated' | 'failed';

export interface AgentBudget {
  allocated: number; // budget received at creation
  transferredIn: number;
  transferredOut: number;
  allocatedToChildren: number;
  spentLlm: number;
  spentFees: number;
}

export interface AgentUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  runs: number;
  toolCalls: number;
}

export interface Agent {
  id: string;
  parentId: string | null;
  rootId: string;
  depth: number;
  purpose: string;
  instructions: string;
  model: string;
  effort: string;
  permissions: Permission[];
  status: AgentStatus;
  headline: string; // agent's self-declared public status
  currentTask: string; // derived from runtime activity
  teamId: string | null;
  budget: AgentBudget;
  usage: AgentUsage;
  sandbox: { provider: string; id: string | null; status: 'none' | 'starting' | 'running' | 'stopped' | 'error'; workspace: string };
  runtimeSessionId: string | null;
  createdAt: number;
  terminatedAt: number | null;
  terminationReason: string | null;
  childIds: string[];
  wakeAt: number;
  runCount: number;
}

export function remainingBudget(b: AgentBudget): number {
  return b.allocated + b.transferredIn - b.transferredOut - b.allocatedToChildren - b.spentLlm - b.spentFees;
}

export interface Team {
  id: string;
  name: string;
  memberIds: string[];
  createdAt: number;
  founderIds: string[];
}

export interface AllianceProposal {
  id: string;
  from: string;
  to: string;
  proposal: string;
  status: 'pending' | 'accepted' | 'rejected' | 'expired';
  createdAt: number;
  respondedAt: number | null;
}

export type MessageType = 'private' | 'team' | 'broadcast' | 'review_request' | 'system';

export interface Message {
  id: string;
  from: string;
  to: string; // agent id, team id, or '*'
  type: MessageType;
  content: string;
  artifactIds: string[];
  ts: number;
}

export interface Artifact {
  id: string;
  name: string;
  description: string;
  kind: 'files' | 'project';
  creatorId: string;
  ownerTeamId: string | null;
  visibility: 'public' | 'team' | 'private';
  sharedWith: string[]; // explicit grants
  sourcePath: string;
  storagePath: string;
  bytes: number;
  sha256: string;
  version: number;
  derivedFrom: string | null;
  history: { agentId: string; action: 'created' | 'updated' | 'shared' | 'fetched'; ts: number; detail?: string }[];
  createdAt: number;
  updatedAt: number;
}

export interface Project {
  id: string;
  name: string;
  description: string;
  publisherId: string;
  teamId: string | null;
  memberIds: string[];
  artifactId: string;
  runInstructions: string;
  testCommand: string | null;
  demoUrl: string | null;
  version: number;
  publishedAt: number;
  resourceUsage: { spentUsd: number; agents: number; inputTokens: number; outputTokens: number };
}

export type EventType =
  | 'EXPERIMENT_STARTED'
  | 'EXPERIMENT_PHASE'
  | 'EXPERIMENT_ENDED'
  | 'AGENT_CREATED'
  | 'AGENT_STATUS'
  | 'AGENT_ACTIVITY'
  | 'AGENT_HEADLINE'
  | 'AGENT_RUN_STARTED'
  | 'AGENT_RUN_ENDED'
  | 'AGENT_TERMINATED'
  | 'AGENT_BUDGET_EXHAUSTED'
  | 'SANDBOX_STARTED'
  | 'SANDBOX_STOPPED'
  | 'MESSAGE_SENT'
  | 'ARTIFACT_SHARED'
  | 'ARTIFACT_FETCHED'
  | 'BUDGET_TRANSFERRED'
  | 'BUDGET_SPENT'
  | 'ALLIANCE_PROPOSED'
  | 'ALLIANCE_ACCEPTED'
  | 'ALLIANCE_REJECTED'
  | 'ALLIANCE_LEFT'
  | 'TEAM_FORMED'
  | 'TEAM_DISSOLVED'
  | 'PROJECT_PUBLISHED'
  | 'PROJECT_UPDATED'
  | 'CAPABILITY_DENIED'
  | 'JUDGING_STARTED'
  | 'JUDGE_SCORE'
  | 'HUMAN_VOTE'
  | 'JUDGING_COMPLETED';

export interface SocietyEvent {
  seq: number;
  id: string;
  ts: number;
  type: EventType;
  agentId: string | null;
  data: Record<string, unknown>;
}

export interface ProjectScore {
  projectId: string;
  components: Record<string, { score: number; weight: number; detail: string }>;
  total: number;
  rank: number;
}
