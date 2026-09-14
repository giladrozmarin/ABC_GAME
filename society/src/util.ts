export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function shellQuote(s: string): string {
  if (/^[A-Za-z0-9_\/.:=@%+-]+$/.test(s)) return s;
  return `'${s.replace(/'/g, `'\\''`)}'`;
}
export const shellJoin = (argv: string[]) => argv.map(shellQuote).join(' ');

export function envPrefix(env: Record<string, string> | undefined): string {
  if (!env || !Object.keys(env).length) return '';
  return Object.entries(env).map(([k, v]) => `export ${k}=${shellQuote(v)};`).join(' ') + ' ';
}

export function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

/** Reject paths that escape the workspace. */
export function safeRelPath(p: string): string {
  const norm = p.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/g, '');
  if (norm === '' || norm === '.') return '.';
  if (norm.startsWith('/') || norm.split('/').includes('..')) throw new Error(`path must be relative to the workspace and must not contain '..': ${p}`);
  return norm;
}

export function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}
