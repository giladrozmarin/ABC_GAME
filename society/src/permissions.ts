import { ALL_PERMISSIONS, type Permission } from './config.js';

export class PermissionError extends Error {}

/** Capability attenuation: a child can only receive a subset of its parent's permissions. */
export function attenuate(parentPerms: Permission[], requested: string[] | undefined): Permission[] {
  const req = requested && requested.length ? requested : parentPerms;
  for (const p of req) {
    if (!(ALL_PERMISSIONS as readonly string[]).includes(p)) throw new PermissionError(`unknown permission '${p}'`);
    if (!parentPerms.includes(p as Permission)) throw new PermissionError(`permission '${p}' exceeds parent's permissions (${parentPerms.join(', ')})`);
  }
  return [...new Set(req)] as Permission[];
}

export function requirePermission(perms: Permission[], p: Permission, what: string) {
  if (!perms.includes(p)) throw new PermissionError(`${what} requires the '${p}' permission which this agent does not have`);
}

/** Map society permissions onto Claude Code built-in tools. */
export function toolsForPermissions(perms: Permission[], allowSubagents: boolean): string[] {
  const tools = new Set<string>(['TodoWrite']);
  if (perms.includes('filesystem')) for (const t of ['Read', 'Write', 'Edit', 'MultiEdit', 'Glob', 'Grep', 'LS', 'NotebookEdit']) tools.add(t);
  if (perms.includes('shell') || perms.includes('git')) tools.add('Bash');
  if (perms.includes('web')) { tools.add('WebFetch'); tools.add('WebSearch'); }
  if (allowSubagents) tools.add('Agent');
  return [...tools];
}
