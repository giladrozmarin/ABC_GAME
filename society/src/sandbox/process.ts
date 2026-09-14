import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { runViaExec, type ExecHandle, type ExecOptions, type Sandbox, type SandboxProvider, type SandboxSpec } from './provider.js';

/**
 * DEVELOPMENT / DEMO provider. Each agent gets its own workspace directory and
 * its own process tree, but NO OS-level isolation: an agent with the `shell`
 * permission can touch the host. Use docker/daytona/e2b for real isolation.
 */
export class ProcessSandboxProvider implements SandboxProvider {
  readonly name = 'process';
  constructor(private baseDir: string) {}

  async create(spec: SandboxSpec): Promise<Sandbox> {
    const workspace = path.resolve(this.baseDir, spec.experimentId, 'workspaces', spec.agentId);
    fs.mkdirSync(workspace, { recursive: true });
    return new ProcessSandbox(`proc:${spec.agentId}`, workspace, spec.env);
  }
}

export class ProcessSandbox implements Sandbox {
  readonly provider = 'process';
  private handles = new Set<ExecHandle>();
  constructor(readonly id: string, readonly workspace: string, private baseEnv: Record<string, string>) {}

  async exec(cmd: string | string[], opts: ExecOptions = {}): Promise<ExecHandle> {
    const env: Record<string, string> = { ...(process.env as Record<string, string>), ...this.baseEnv, ...(opts.env ?? {}) };
    // Never leak the orchestrator's own Claude Code session identity into agent runs.
    delete env.CLAUDE_CODE_SESSION_ID;
    delete env.CLAUDECODE;
    const argv = Array.isArray(cmd) ? cmd : ['bash', '-lc', cmd];
    const child = spawn(argv[0], argv.slice(1), { cwd: opts.cwd ?? this.workspace, env, stdio: ['pipe', 'pipe', 'pipe'] });
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (c: string) => opts.onStdout?.(c));
    child.stderr.on('data', (c: string) => opts.onStderr?.(c));
    if (opts.stdin !== undefined) child.stdin.end(opts.stdin); else child.stdin.end();
    const done = new Promise<{ exitCode: number }>((resolve) => {
      child.on('error', () => resolve({ exitCode: 127 }));
      child.on('close', (code, signal) => resolve({ exitCode: code ?? (signal ? 137 : 1) }));
    });
    let timer: NodeJS.Timeout | undefined;
    if (opts.timeoutMs) timer = setTimeout(() => child.kill('SIGKILL'), opts.timeoutMs);
    const handle: ExecHandle = {
      wait: async () => { const r = await done; if (timer) clearTimeout(timer); this.handles.delete(handle); return r; },
      kill: async () => { try { child.kill('SIGTERM'); setTimeout(() => { try { child.kill('SIGKILL'); } catch {} }, 3000).unref(); } catch {} },
    };
    this.handles.add(handle);
    return handle;
  }

  run(cmd: string | string[], opts?: ExecOptions) { return runViaExec(this, cmd, opts); }

  async writeFile(absPath: string, data: Buffer | string) {
    fs.mkdirSync(path.dirname(absPath), { recursive: true });
    fs.writeFileSync(absPath, data);
  }
  async readFile(absPath: string) { return fs.readFileSync(absPath); }

  async destroy() {
    for (const h of this.handles) await h.kill();
    // Workspace is kept on disk as part of the experiment record.
  }
}
