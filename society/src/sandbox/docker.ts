import { spawn } from 'node:child_process';
import { runViaExec, type ExecHandle, type ExecOptions, type Sandbox, type SandboxProvider, type SandboxSpec } from './provider.js';
import { shellJoin } from '../util.js';

export interface DockerOptions { image: string; network?: string; memory?: string; cpus?: string; pidsLimit?: number; setupCommand?: string }

/**
 * One container per agent. The container gets NO docker socket, no host mounts,
 * resource limits, and only the env the orchestrator hands it. The orchestrator
 * talks to the docker CLI on the host; agents never can.
 */
export class DockerSandboxProvider implements SandboxProvider {
  readonly name = 'docker';
  constructor(private opts: DockerOptions) {}

  async create(spec: SandboxSpec): Promise<Sandbox> {
    const name = `society-${spec.experimentId}-${spec.agentId}`.toLowerCase().replace(/[^a-z0-9_.-]/g, '-');
    const args = ['run', '-d', '--name', name, '--label', `society.experiment=${spec.experimentId}`, '--label', `society.agent=${spec.agentId}`,
      '--memory', this.opts.memory ?? '2g', '--cpus', this.opts.cpus ?? '2', '--pids-limit', String(this.opts.pidsLimit ?? 1024),
      '--add-host', 'host.docker.internal:host-gateway', '-w', '/workspace', '--stop-timeout', '5'];
    if (this.opts.network) args.push('--network', this.opts.network);
    for (const [k, v] of Object.entries(spec.env)) args.push('-e', `${k}=${v}`);
    for (const [k, v] of Object.entries(spec.labels ?? {})) args.push('--label', `${k}=${v}`);
    args.push(this.opts.image, 'sh', '-c', `mkdir -p /workspace && sleep ${spec.lifetimeSec}`);
    const r = await dockerRun(args);
    if (r.exitCode !== 0) throw new Error(`docker run failed: ${r.stderr}`);
    const sb = new DockerSandbox(name, spec.env);
    if (this.opts.setupCommand) {
      const s = await sb.run(this.opts.setupCommand, { timeoutMs: 10 * 60_000 });
      if (s.exitCode !== 0) throw new Error(`sandbox setup failed: ${s.stderr.slice(-2000)}`);
    }
    return sb;
  }

  async cleanupAll(experimentId: string) {
    const r = await dockerRun(['ps', '-aq', '--filter', `label=society.experiment=${experimentId}`]);
    const ids = r.stdout.split('\n').map((s) => s.trim()).filter(Boolean);
    if (ids.length) await dockerRun(['rm', '-f', ...ids]);
  }
}

class DockerSandbox implements Sandbox {
  readonly provider = 'docker';
  readonly workspace = '/workspace';
  constructor(readonly id: string, private baseEnv: Record<string, string>) {}

  async exec(cmd: string | string[], opts: ExecOptions = {}): Promise<ExecHandle> {
    const args = ['exec', '-i', '-w', opts.cwd ?? this.workspace];
    for (const [k, v] of Object.entries({ ...this.baseEnv, ...(opts.env ?? {}) })) args.push('-e', `${k}=${v}`);
    args.push(this.id, 'bash', '-lc', Array.isArray(cmd) ? shellJoin(cmd) : cmd);
    const child = spawn('docker', args, { stdio: ['pipe', 'pipe', 'pipe'] });
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    child.stdout.on('data', (c: string) => opts.onStdout?.(c));
    child.stderr.on('data', (c: string) => opts.onStderr?.(c));
    if (opts.stdin !== undefined) child.stdin.end(opts.stdin); else child.stdin.end();
    const done = new Promise<{ exitCode: number }>((resolve) => {
      child.on('error', () => resolve({ exitCode: 127 }));
      child.on('close', (code) => resolve({ exitCode: code ?? 1 }));
    });
    let timer: NodeJS.Timeout | undefined;
    if (opts.timeoutMs) timer = setTimeout(() => child.kill('SIGKILL'), opts.timeoutMs);
    return {
      wait: async () => { const r = await done; if (timer) clearTimeout(timer); return r; },
      // Killing the local `docker exec` client does not always kill the remote process; also signal inside the container.
      kill: async () => { child.kill('SIGTERM'); await dockerRun(['exec', this.id, 'pkill', '-f', 'claude']).catch(() => {}); },
    };
  }
  run(cmd: string | string[], opts?: ExecOptions) { return runViaExec(this, cmd, opts); }
  async writeFile(absPath: string, data: Buffer | string) {
    const r = await this.run(`mkdir -p "$(dirname ${shellJoin([absPath])})" && cat > ${shellJoin([absPath])}`, { stdin: data });
    if (r.exitCode !== 0) throw new Error(`writeFile failed: ${r.stderr}`);
  }
  async readFile(absPath: string) {
    const r = await this.run(['base64', '-w0', absPath]);
    if (r.exitCode !== 0) throw new Error(`readFile failed: ${r.stderr}`);
    return Buffer.from(r.stdout.trim(), 'base64');
  }
  async destroy() { await dockerRun(['rm', '-f', this.id]); }
}

function dockerRun(args: string[]): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn('docker', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = ''; let stderr = '';
    child.stdout.on('data', (c) => (stdout += c));
    child.stderr.on('data', (c) => (stderr += c));
    child.on('error', (e) => resolve({ exitCode: 127, stdout, stderr: String(e) }));
    child.on('close', (code) => resolve({ exitCode: code ?? 1, stdout, stderr }));
  });
}
