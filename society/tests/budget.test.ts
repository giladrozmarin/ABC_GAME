import { describe, it, expect } from 'vitest';
import { makeSociety } from './helpers.js';
import { BudgetError } from '../src/economy/ledger.js';

const child = (s: any, parent: string, budget: number, perms?: string[]) => s.spawn(parent, { purpose: 'specialist', instructions: 'do the thing', budgetUsd: budget, permissions: perms });

describe('budget invariants', () => {
  it('spawning moves budget from parent to child (no duplication)', () => {
    const { society: s } = makeSociety();
    const a = s.createRoot(20);
    const c = child(s, a.id, 4);
    expect(s.remaining(a.id)).toBeCloseTo(16);
    expect(s.remaining(c.id)).toBeCloseTo(4);
    expect(s.ledger.audit().ok).toBe(true);
  });

  it('rejects spawning with more budget than the parent has', () => {
    const { society: s } = makeSociety();
    const a = s.createRoot(20);
    expect(() => child(s, a.id, 25)).toThrow(BudgetError);
    expect(s.remaining(a.id)).toBeCloseTo(20);
    expect(a.childIds.length).toBe(0);
  });

  it('rejects child budgets below the minimum and non-positive', () => {
    const { society: s } = makeSociety();
    const a = s.createRoot(20);
    expect(() => child(s, a.id, 0.1)).toThrow(BudgetError);
    expect(() => child(s, a.id, -3)).toThrow(BudgetError);
    expect(() => child(s, a.id, NaN)).toThrow(BudgetError);
  });

  it('transfers are conserved and cannot overdraw', () => {
    const { society: s } = makeSociety();
    const a = s.createRoot(20); const b = s.createRoot(20);
    s.transfer(a.id, b.id, 5, 'investment');
    expect(s.remaining(a.id)).toBeCloseTo(15);
    expect(s.remaining(b.id)).toBeCloseTo(25);
    expect(() => s.transfer(a.id, b.id, 15.01, '')).toThrow(BudgetError);
    expect(() => s.transfer(a.id, a.id, 1, '')).toThrow(BudgetError);
    expect(() => s.transfer(a.id, b.id, -1, '')).toThrow(BudgetError);
    expect(s.ledger.audit().ok).toBe(true);
  });

  it('LLM spend and fees reduce remaining; fees cannot overdraw', () => {
    const { society: s } = makeSociety();
    const a = s.createRoot(1);
    s.chargeLlm(a.id, 0.4);
    s.chargeFee(a.id, 0.05, 'broadcast');
    expect(s.remaining(a.id)).toBeCloseTo(0.55);
    expect(() => s.chargeFee(a.id, 0.6, 'msg')).toThrow(BudgetError);
    expect(s.ledger.audit().ok).toBe(true);
  });

  it('terminating a subtree refunds unspent budget up the tree', () => {
    const { society: s } = makeSociety();
    const a = s.createRoot(20);
    const a1 = child(s, a.id, 6);
    const a1a = child(s, a1.id, 2);
    s.chargeLlm(a1a.id, 0.5);
    s.chargeLlm(a1.id, 1);
    s.terminate(a1.id, a.id, 'done');
    expect(s.agents.get(a1a.id)!.status).toBe('terminated');
    expect(s.remaining(a1a.id)).toBeCloseTo(0);
    expect(s.remaining(a1.id)).toBeCloseTo(0);
    // 20 - 6 + (6 - 1 - 2) + (2 - 0.5) = 18.5
    expect(s.remaining(a.id)).toBeCloseTo(18.5);
    expect(s.ledger.audit().ok).toBe(true);
  });

  it('global budget cap on root allocations', () => {
    const { society: s } = makeSociety({ maxTotalBudgetUsd: 30, rootAgents: 1 });
    s.createRoot(20);
    expect(() => s.createRoot(20)).toThrow(BudgetError);
  });

  it('conservation holds under random operations', () => {
    const { society: s } = makeSociety({ maxTotalAgents: 40, maxChildrenPerAgent: 6, maxDepth: 6 });
    for (let i = 0; i < 4; i++) s.createRoot(20);
    let seed = 42; const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
    for (let i = 0; i < 400; i++) {
      const alive = s.aliveAgents; if (!alive.length) break;
      const x = alive[Math.floor(rnd() * alive.length)];
      const op = rnd();
      try {
        if (op < 0.25) child(s, x.id, 0.5 + rnd() * 5);
        else if (op < 0.5) { const y = alive[Math.floor(rnd() * alive.length)]; s.transfer(x.id, y.id, rnd() * 3, ''); }
        else if (op < 0.75) { const c = rnd() * 0.5; if (s.remaining(x.id) >= c) s.chargeLlm(x.id, c); }
        else if (op < 0.85) s.chargeFee(x.id, 0.01, 'msg');
        else if (x.childIds.length) s.terminate(x.childIds[0], x.id, 'random');
      } catch (e) { if (!(e instanceof Error)) throw e; }
      const audit = s.ledger.audit();
      expect(audit.ok, `after op ${i}: ${JSON.stringify(audit)}`).toBe(true);
      for (const a of s.agents.values()) expect(s.remaining(a.id)).toBeGreaterThanOrEqual(-1e-9);
    }
  });
});
