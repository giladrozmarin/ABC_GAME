/**
 * Sandbox abstraction. The orchestrator owns all provider credentials; agents
 * never see them. A sandbox is a workspace + an exec channel; nothing else.
 */
export interface ExecOptions {
  cwd?: string; // absolute path inside sandbox; defaults to the workspace
  env?: Record<string, string>;
  onStdout?: (chunk: string) => void;
  onStderr?: (chunk: string) => void;
  timeoutMs?: number;
  stdin?: string | Buffer;
}

export interface ExecHandle {
  wait(): Promise<{ exitCode: number }>;
  kill(): Promise<void>;
}

export interface ExecResult { exitCode: number; stdout: string; stderr: string }

export interface Sandbox {
  readonly id: string;
  readonly provider: string;
  /** Absolute workspace path inside the sandbox. */
  readonly workspace: string;
  /** Start a command. `argv` arrays are exec'd directly where possible; strings run via `bash -lc`. */
  exec(cmd: string | string[], opts?: ExecOptions): Promise<ExecHandle>;
  /** Run to completion and capture output. */
  run(cmd: string | string[], opts?: ExecOptions): Promise<ExecResult>;
  writeFile(absPath: string, data: Buffer | string): Promise<void>;
  readFile(absPath: string): Promise<Buffer>;
  destroy(): Promise<void>;
}

export interface SandboxSpec {
  experimentId: string;
  agentId: string;
  /** Environment injected into every command (scoped credentials, orchestrator URL). */
  env: Record<string, string>;
  labels?: Record<string, string>;
  lifetimeSec: number;
}

export interface SandboxProvider {
  readonly name: string;
  create(spec: SandboxSpec): Promise<Sandbox>;
  /** Best-effort cleanup of everything belonging to an experiment. */
  cleanupAll?(experimentId: string): Promise<void>;
}

/** Generic run() built on exec() for providers that only implement streaming exec. */
export async function runViaExec(sb: Pick<Sandbox, 'exec'>, cmd: string | string[], opts: ExecOptions = {}): Promise<ExecResult> {
  let stdout = '';
  let stderr = '';
  const h = await sb.exec(cmd, {
    ...opts,
    onStdout: (c) => { stdout += c; opts.onStdout?.(c); },
    onStderr: (c) => { stderr += c; opts.onStderr?.(c); },
  });
  const { exitCode } = await h.wait();
  return { exitCode, stdout, stderr };
}
