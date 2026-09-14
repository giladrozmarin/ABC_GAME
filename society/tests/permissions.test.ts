import { describe, it, expect } from 'vitest';
import { makeSociety } from './helpers.js';
import { attenuate, PermissionError, toolsForPermissions } from '../src/permissions.js';
import { SocietyError } from '../src/society/society.js';

describe('permission attenuation', () => {
  it('child permissions must be a subset of the parent', () => {
    expect(attenuate(['filesystem', 'git', 'web'] as any, ['filesystem', 'git'])).toEqual(['filesystem', 'git']);
    expect(() => attenuate(['filesystem', 'git'] as any, ['filesystem', 'git', 'web'])).toThrow(PermissionError);
    expect(() => attenuate(['filesystem'] as any, ['aws-admin'])).toThrow(PermissionError);
    expect(attenuate(['filesystem', 'shell'] as any, undefined)).toEqual(['filesystem', 'shell']);
  });

  it('is enforced recursively through the tree', () => {
    const { society: s } = makeSociety();
    const a = s.createRoot(20);
    const a1 = s.spawn(a.id, { purpose: 'p', instructions: 'i i i i i i', budgetUsd: 5, permissions: ['filesystem', 'spawn', 'messaging'] });
    expect(a1.permissions).toEqual(['filesystem', 'spawn', 'messaging']);
    expect(() => s.spawn(a1.id, { purpose: 'p', instructions: 'i i i i i i', budgetUsd: 1, permissions: ['filesystem', 'shell'] })).toThrow(PermissionError);
    const a1a = s.spawn(a1.id, { purpose: 'p', instructions: 'i i i i i i', budgetUsd: 1, permissions: ['filesystem'] });
    expect(a1a.permissions).toEqual(['filesystem']);
    // a1a has no 'spawn' permission
    expect(() => s.spawn(a1a.id, { purpose: 'p', instructions: 'i i i i i i', budgetUsd: 0.5 })).toThrow(PermissionError);
  });

  it('maps permissions to runtime tools', () => {
    expect(toolsForPermissions(['filesystem'] as any, false)).not.toContain('Bash');
    expect(toolsForPermissions(['shell'] as any, false)).toContain('Bash');
    expect(toolsForPermissions(['web'] as any, false)).toContain('WebFetch');
    expect(toolsForPermissions(['filesystem', 'shell'] as any, false)).not.toContain('Agent');
  });

  it('agents without trade/messaging/publish permissions are blocked', () => {
    const { society: s } = makeSociety();
    const a = s.createRoot(20);
    const c = s.spawn(a.id, { purpose: 'p', instructions: 'i i i i i i', budgetUsd: 2, permissions: ['filesystem'] });
    expect(() => s.transfer(c.id, a.id, 1, '')).toThrow(PermissionError);
    expect(() => s.send(c.id, a.id, 'hi')).toThrow(PermissionError);
    expect(() => s.publishProject(c.id, { name: 'x', description: 'y', artifactId: 'a', runInstructions: 'r' })).toThrow(PermissionError);
  });

  it('only a parent can terminate its child', () => {
    const { society: s } = makeSociety();
    const a = s.createRoot(20); const b = s.createRoot(20);
    const a1 = s.spawn(a.id, { purpose: 'p', instructions: 'i i i i i i', budgetUsd: 2 });
    expect(() => s.terminate(a1.id, b.id, 'sabotage')).toThrow(PermissionError);
    expect(() => s.terminate(a.id, a1.id, 'coup')).toThrow(PermissionError);
    expect(s.terminate(a1.id, a.id, 'ok')).toEqual([a1.id]);
  });
});

describe('global limits', () => {
  const req = (b = 1) => ({ purpose: 'p', instructions: 'i i i i i i', budgetUsd: b });
  it('max depth', () => {
    const { society: s } = makeSociety({ maxDepth: 3 });
    const a = s.createRoot(20);
    const a1 = s.spawn(a.id, req(5));
    const a1a = s.spawn(a1.id, req(2));
    expect(() => s.spawn(a1a.id, req(1))).toThrow(/depth/);
  });
  it('max children per agent (terminated children free a slot)', () => {
    const { society: s } = makeSociety({ maxChildrenPerAgent: 2 });
    const a = s.createRoot(20);
    const c1 = s.spawn(a.id, req()); s.spawn(a.id, req());
    expect(() => s.spawn(a.id, req())).toThrow(/max children/);
    s.terminate(c1.id, a.id, 'done');
    expect(() => s.spawn(a.id, req())).not.toThrow();
  });
  it('max total agents', () => {
    const { society: s } = makeSociety({ maxTotalAgents: 3, rootAgents: 2 });
    const a = s.createRoot(20); s.createRoot(20);
    s.spawn(a.id, req());
    expect(() => s.spawn(a.id, req())).toThrow(/max total agents/);
    expect(() => s.createRoot(20)).toThrow(SocietyError);
  });
  it('disallowed model is rejected', () => {
    const { society: s } = makeSociety({ allowedModels: ['claude-haiku-4-5'] });
    const a = s.createRoot(20);
    expect(() => s.spawn(a.id, { ...req(), model: 'claude-fable-5-1' })).toThrow(/not allowed/);
  });
});
