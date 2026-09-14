import { runViaExec, type ExecHandle, type ExecOptions, type Sandbox, type SandboxProvider, type SandboxSpec } from './provider.js';
import { shellJoin } from '../util.js';

export interface E2BOptions { apiKey: string; template: string; setupCommand?: string }

/** E2B provider. Optional dependency, loaded lazily. */
export class E2BSandboxProvider implements SandboxProvider {
  readonly name = 'e2b';
  constructor(private opts: E2BOptions) {}

  async create(spec: SandboxSpec): Promise<Sandbox> {
    const mod: any = await import('e2b');
    const sandbox = await mod.Sandbox.create(this.opts.template, {
      apiKey: this.opts.apiKey,
      envs: spec.env,
      timeoutMs: spec.lifetimeSec * 1000,
      metadata: { 'society.experiment': spec.experimentId, 'society.agent': spec.agentId, ...(spec.labels ?? {}) },
    });
    const workspace = '/home/user/workspace';
    const sb = new E2BSandbox(sandbox, workspace, spec.env);
    await sb.run(`mkdir -p ${shellJoin([workspace])}`);
    if (this.opts.setupCommand) {
      const s = await sb.run(this.opts.setupCommand, { timeoutMs: 15 * 60_000 });
      if (s.exitCode !== 0) throw new Error(`sandbox setup failed: ${s.stderr.slice(-2000)}`);
    }
    return sb;
  }
}

class E2BSandbox implements Sandbox {
  readonly provider = 'e2b';
  readonly id: string;
  constructor(private sandbox: any, readonly workspace: string, private baseEnv: Record<string, string>) { this.id = sandbox.sandboxId; }

  async exec(cmd: string | string[], opts: ExecOptions = {}): Promise<ExecHandle> {
    let command = Array.isArray(cmd) ? shellJoin(cmd) : cmd;
    if (opts.stdin !== undefined) {
      const tmp = `/tmp/stdin-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      await this.sandbox.files.write(tmp, opts.stdin);
      command = `${command} < ${tmp}`;
    }
    const handle = await this.sandbox.commands.run(command, {
      background: true,
      cwd: opts.cwd ?? this.workspace,
      envs: { ...this.baseEnv, ...(opts.env ?? {}) },
      onStdout: (c: string) => opts.onStdout?.(c),
      onStderr: (c: string) => opts.onStderr?.(c),
      timeoutMs: opts.timeoutMs ?? 0,
    });
    return {
      wait: async () => {
        try { const r = await handle.wait(); return { exitCode: Number(r.exitCode ?? 0) }; }
        catch (e: any) { return { exitCode: Number(e?.exitCode ?? 1) }; }
      },
      kill: async () => { try { await handle.kill(); } catch {} },
    };
  }
  run(cmd: string | string[], opts?: ExecOptions) { return runViaExec(this, cmd, opts); }
  async writeFile(absPath: string, data: Buffer | string) { await this.sandbox.files.write(absPath, Buffer.isBuffer(data) ? new Uint8Array(data).buffer : data); }
  async readFile(absPath: string) { const b = await this.sandbox.files.read(absPath, { format: 'bytes' }); return Buffer.from(b); }
  async destroy() { try { await this.sandbox.kill(); } catch {} }
}
