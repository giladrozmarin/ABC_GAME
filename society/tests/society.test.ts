import { describe, it, expect } from 'vitest';
import { makeSociety } from './helpers.js';
import { PermissionError } from '../src/permissions.js';
import type { Artifact } from '../src/types.js';

const art = (creator: string, visibility: Artifact['visibility'], team: string | null = null): Artifact => ({ id: `art_${creator}_${visibility}`, name: 'x', description: '', kind: 'files', creatorId: creator, ownerTeamId: team, visibility, sharedWith: [], sourcePath: '.', storagePath: '/dev/null', bytes: 1, sha256: '', version: 1, derivedFrom: null, history: [], createdAt: 0, updatedAt: 0 });

describe('messaging & alliances', () => {
  it('messages cost fees, land in inboxes, and are logged', () => {
    const { society: s, store } = makeSociety();
    const a = s.createRoot(20); const b = s.createRoot(20); s.createRoot(20);
    s.send(a.id, b.id, 'hello');
    expect(s.peekInbox(b.id).length).toBe(1);
    expect(s.remaining(a.id)).toBeCloseTo(19.99);
    s.send(a.id, '*', 'everyone', 'broadcast');
    expect(s.peekInbox(b.id).length).toBe(2);
    expect(s.remaining(a.id)).toBeCloseTo(19.94);
    expect(store.listEvents({ types: ['MESSAGE_SENT'] }).length).toBe(2);
    expect(s.drainInbox(b.id).length).toBe(2);
    expect(s.peekInbox(b.id).length).toBe(0);
  });

  it('alliance proposal → accept forms a team; children join; leave dissolves', () => {
    const { society: s } = makeSociety();
    const a = s.createRoot(20); const b = s.createRoot(20);
    const p = s.proposeAlliance(a.id, b.id, 'join me');
    expect(() => s.respondAlliance(a.id, p.id, true)).toThrow(PermissionError);
    const { team } = s.respondAlliance(b.id, p.id, true);
    expect(team!.memberIds.sort()).toEqual([a.id, b.id]);
    expect(s.agents.get(a.id)!.teamId).toBe(team!.id);
    const c = s.spawn(a.id, { purpose: 'p', instructions: 'i i i i i i', budgetUsd: 2 });
    expect(c.teamId).toBe(team!.id);
    s.send(a.id, 'team', 'team msg');
    expect(s.peekInbox(b.id).some((m) => m.type === 'team')).toBe(true);
    expect(s.peekInbox(c.id).some((m) => m.type === 'team')).toBe(true);
    s.leaveAlliance(b.id);
    expect(s.teams.get(team!.id)!.memberIds.sort()).toEqual([a.id, c.id]);
    s.leaveAlliance(c.id);
    expect(s.teams.has(team!.id)).toBe(false);
    expect(s.agents.get(a.id)!.teamId).toBeNull();
  });

  it('teams merge when both sides already have teams', () => {
    const { society: s } = makeSociety();
    const [a, b, c, d] = [s.createRoot(20), s.createRoot(20), s.createRoot(20), s.createRoot(20)];
    s.respondAlliance(b.id, s.proposeAlliance(a.id, b.id, '').id, true);
    s.respondAlliance(d.id, s.proposeAlliance(c.id, d.id, '').id, true);
    s.respondAlliance(c.id, s.proposeAlliance(a.id, c.id, 'merge').id, true);
    expect(s.teams.size).toBe(1);
    expect([...s.teams.values()][0].memberIds.sort()).toEqual([a.id, b.id, c.id, d.id]);
  });

  it('rejection is recorded and no team forms', () => {
    const { society: s, store } = makeSociety();
    const a = s.createRoot(20); const b = s.createRoot(20);
    const p = s.proposeAlliance(a.id, b.id, '');
    s.respondAlliance(b.id, p.id, false, 'no thanks');
    expect(s.teams.size).toBe(0);
    expect(store.listEvents({ types: ['ALLIANCE_REJECTED'] }).length).toBe(1);
  });
});

describe('artifact access control', () => {
  it('private artifacts are only visible to creator and explicit grants; team to team; public to all', () => {
    const { society: s } = makeSociety();
    const a = s.createRoot(20); const b = s.createRoot(20); const c = s.createRoot(20);
    s.respondAlliance(b.id, s.proposeAlliance(a.id, b.id, '').id, true);
    const teamId = s.agents.get(a.id)!.teamId!;
    const priv = art(a.id, 'private'); const team = art(a.id, 'team', teamId); const pub = art(a.id, 'public');
    for (const x of [priv, team, pub]) s.registerArtifact(x);
    expect(s.canAccessArtifact(b.id, priv)).toBe(false);
    expect(s.canAccessArtifact(b.id, team)).toBe(true);
    expect(s.canAccessArtifact(c.id, team)).toBe(false);
    expect(s.canAccessArtifact(c.id, pub)).toBe(true);
    // sharing by message grants access
    s.send(a.id, c.id, 'here you go', 'private', [priv.id]);
    expect(s.canAccessArtifact(c.id, priv)).toBe(true);
    // c cannot forward what it can't access
    expect(() => s.send(c.id, b.id, 'leak', 'private', [team.id])).toThrow(PermissionError);
  });
});

describe('projects', () => {
  it('republishing updates the same project and team members share one project', () => {
    const { society: s } = makeSociety();
    const a = s.createRoot(20); const b = s.createRoot(20);
    s.respondAlliance(b.id, s.proposeAlliance(a.id, b.id, '').id, true);
    const p1 = s.publishProject(a.id, { name: 'X', description: 'd', artifactId: 'art1', runInstructions: 'run' });
    const p2 = s.publishProject(b.id, { name: 'X2', description: 'd', artifactId: 'art2', runInstructions: 'run' });
    expect(p2.id).toBe(p1.id);
    expect(p2.version).toBe(2);
    expect(s.projects.size).toBe(1);
    expect(p2.memberIds.sort()).toEqual([a.id, b.id]);
  });
});
