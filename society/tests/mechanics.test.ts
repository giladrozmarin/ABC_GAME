import { describe, it, expect } from 'vitest';
import { makeSociety } from './helpers.js';
import { SocietyError } from '../src/society/society.js';

const req = (b = 1, extra: any = {}) => ({ purpose: 'helper', instructions: 'do useful work', budgetUsd: b, ...extra });

describe('collaboration grant', () => {
  it('is hidden until unlocked, claimable once by a team with enough founding agents, and conserved', () => {
    const { society: s } = makeSociety({ grantUsd: 40, grantMinRoots: 3 });
    const [a, b, c, d] = [s.createRoot(20), s.createRoot(20), s.createRoot(20), s.createRoot(20)];
    expect(s.stateFor(a.id).grant).toBeUndefined();
    expect(() => s.claimGrant(a.id)).toThrow(/no grant/);
    s.unlockGrant();
    expect(s.peekInbox(d.id).some((m) => /grant/i.test(m.content))).toBe(true);
    expect(() => s.claimGrant(a.id)).toThrow(/team/);
    s.respondAlliance(b.id, s.proposeAlliance(a.id, b.id, '').id, true);
    expect(() => s.claimGrant(a.id)).toThrow(/at least 3/);
    // children do not count as founding agents
    s.spawn(a.id, req(2)); s.spawn(b.id, req(2));
    expect(() => s.claimGrant(a.id)).toThrow(/at least 3/);
    s.respondAlliance(c.id, s.proposeAlliance(a.id, c.id, '').id, true);
    const r = s.claimGrant(b.id);
    expect(r.recipients.sort()).toEqual([a.id, b.id, c.id]);
    expect(s.remaining(a.id)).toBeCloseTo(20 - 2 - 0.02 + 40 / 3, 4); // two proposal fees
    expect(() => s.claimGrant(c.id)).toThrow(/already claimed/);
    expect(s.ledger.audit().ok).toBe(true);
    expect(s.ledger.audit().rootAllocated).toBeCloseTo(120, 4);
  });
});

describe('free assistants', () => {
  it('require an open window, cost nothing, and cannot chain', () => {
    const { society: s } = makeSociety({ freeWindowSec: 600, freeModel: 'claude-haiku-4-5-20251001' });
    const a = s.createRoot(20);
    expect(() => s.spawn(a.id, req(0, { free: true }))).toThrow(/activate_free_assistants/);
    s.activateFreeWindow(a.id);
    expect(() => s.activateFreeWindow(a.id)).toThrow(/already/);
    const f = s.spawn(a.id, req(0, { free: true }));
    expect(f.free).toBe(true);
    expect(f.model).toBe('claude-haiku-4-5-20251001');
    expect(s.remaining(a.id)).toBe(20);
    s.chargeLlm(f.id, 1.5);
    expect(f.budget.freeSpent).toBeCloseTo(1.5);
    expect(s.remaining(a.id)).toBe(20);
    expect(s.ledger.audit().ok).toBe(true);
    // free assistants can report back to their parent without a budget
    s.send(f.id, a.id, 'results attached');
    expect(s.peekInbox(a.id).length).toBe(1);
    expect(s.remaining(f.id)).toBe(0);
    expect(() => s.spawn(f.id, req(0, { free: true }))).toThrow(/cannot spawn free/);
    expect(() => s.activateFreeWindow(f.id)).toThrow(/cannot open/);
    a.freeUntil = Date.now() - 1;
    expect(() => s.spawn(a.id, req(0, { free: true }))).toThrow(/closed/);
  });
  it('is disabled unless configured', () => {
    const { society: s } = makeSociety();
    const a = s.createRoot(20);
    expect(() => s.activateFreeWindow(a.id)).toThrow(SocietyError);
  });
});

describe('oracle', () => {
  it('allows exactly the configured number of questions', () => {
    const { society: s } = makeSociety({ oracleUses: 1 });
    const a = s.createRoot(20);
    expect(s.useOracle(a.id)).toBe(0);
    expect(() => s.useOracle(a.id)).toThrow(/already used/);
  });
});
