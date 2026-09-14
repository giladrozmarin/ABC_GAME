import { runViaExec, type ExecHandle, type ExecOptions, type Sandbox, type SandboxProvider, type SandboxSpec } from './provider.js';
import { envPrefix, shellJoin } from '../util.js';
import { newId } from '../ids.js';

export interface DaytonaOptions { apiKey: string; apiUrl?: string; snapshot?: string; image: string; setupCommand?: string }

/**
 * Daytona provider (preferred for real runs). The orchestrator holds the
 * Daytona API key; each agent only receives its own scoped LLM-gateway token.
 * The SDK is an optional dependency, loaded lazily.
 */
export class DaytonaSandboxProvider implements SandboxProvider {
  readonly name = 'daytona';
  private client: any;
  constructor(private opts: DaytonaOptions) {}

  private async daytona() {
    if (!this.client) {
      const mod: any = await import('@daytonaio/sdk');
      this.client = new mod.Daytona({ apiKey: this.opts.apiKey, apiUrl: this.opts.apiUrl });
    }
    return this.client;
  }

  async create(spec: SandboxSpec): Promise<Sandbox> {
    const daytona = await this.daytona();
    const base = {
      envVars: spec.env,
      labels: { 'society.experiment': spec.experimentId, 'society.agent': spec.agentId, ...(spec.labels ?? {}) },
      autoStopInterval: 0,
      autoDeleteInterval: Math.ceil(spec.lifetimeSec / 60) + 30,
    };
    const params = this.opts.snapshot ? { ...base, snapshot: this.opts.snapshot } : { ...base, image: this.opts.image };
    const sandbox = await daytona.create(params, { timeout: 600 });
    const workDir: string = (await sandbox.getWorkDir?.()) ?? (await sandbox.getUserRootDir?.()) ?? '/home/daytona';
    const workspace = `${workDir.replace(/\/$/, '')}/workspace`;
    const sb = new DaytonaSandbox(sandbox, workspace, spec.env);
    await sb.run(`mkdir -p ${shellJoin([workspace])}`);
    if (this.opts.setupCommand) {
      const s = await sb.run(this.opts.setupCommand, { timeoutMs: 15 * 60_000 });
      if (s.exitCode !== 0) throw new Error(`sandbox setup failed: ${s.stderr.slice(-2000) || s.stdout.slice(-2000)}`);
    }
    return sb;
  }
}

class DaytonaSandbox implements Sandbox {
  readonly provider = 'daytona';
  readonly id: string;
  constructor(private sandbox: any, readonly workspace: string, private baseEnv: Record<string, string>) { this.id = sandbox.id; }

  async exec(cmd: string | string[], opts: ExecOptions = {}): Promise<ExecHandle> {
    const sessionId = newId('sess');
    const proc = this.sandbox.process;
    await proc.createSession(sessionId);
    const command = `cd ${shellJoin([opts.cwd ?? this.workspace])} && ${envPrefix({ ...this.baseEnv, ...(opts.env ?? {}) })}${Array.isArray(cmd) ? shellJoin(cmd) : cmd}`;
    let stdinPrefix = '';
    if (opts.stdin !== undefined) {
      // Session commands have no stdin; stage it in a temp file.
      const tmp = `/tmp/${sessionId}.stdin`;
      await this.sandbox.fs.uploadFile(Buffer.isBuffer(opts.stdin) ? opts.stdin : Buffer.from(opts.stdin), tmp);
      stdinPrefix = `< ${tmp} `;
    }
    const resp = await proc.executeSessionCommand(sessionId, { command: stdinPrefix ? `${command} ${stdinPrefix}` : command, runAsync: true });
    const cmdId: string = resp.cmdId ?? resp.id;
    const finished = (async () => {
      await proc.getSessionCommandLogs(sessionId, cmdId, (c: string) => opts.onStdout?.(c), (c: string) => opts.onStderr?.(c));
      const info = await proc.getSessionCommand(sessionId, cmdId);
      return { exitCode: Number(info.exitCode ?? 0) };
    })();
    let timer: NodeJS.Timeout | undefined;
    const kill = async () => { try { await proc.deleteSession(sessionId); } catch {} };
    if (opts.timeoutMs) timer = setTimeout(kill, opts.timeoutMs);
    return {
      wait: async () => { try { return await finished; } catch { return { exitCode: 137 }; } finally { if (timer) clearTimeout(timer); await kill(); } },
      kill,
    };
  }
  run(cmd: string | string[], opts?: ExecOptions) { return runViaExec(this, cmd, opts); }
  async writeFile(absPath: string, data: Buffer | string) { await this.sandbox.fs.uploadFile(Buffer.isBuffer(data) ? data : Buffer.from(data), absPath); }
  async readFile(absPath: string) { return Buffer.from(await this.sandbox.fs.downloadFile(absPath)); }
  async destroy() { try { await this.sandbox.delete(60); } catch {} }
}
