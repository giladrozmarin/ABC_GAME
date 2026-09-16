import { remainingBudget, type Agent } from '../types.js';

export class BudgetError extends Error {}

/**
 * Budget rules. Budget is conserved: it can only move between agents or be spent.
 * Invariant: sum(root allocations) == sum over all agents of (remaining + spent).
 */
export class Ledger {
  /** Money that entered the society from outside the root allocations (e.g. a claimed grant). */
  externalInflow = 0;
  constructor(private agents: Map<string, Agent>, private opts: { minChildBudgetUsd: number }) {}

  /** Credit budget from an external source (grant). Conservation is tracked via externalInflow. */
  grant(toId: string, amount: number) {
    const to = this.agents.get(toId);
    if (!to) throw new BudgetError('unknown agent');
    if (!(amount > 0)) throw new BudgetError('grant must be positive');
    to.budget.transferredIn = round(to.budget.transferredIn + amount);
    this.externalInflow = round(this.externalInflow + amount);
  }

  remaining(agentId: string): number {
    const a = this.agents.get(agentId);
    if (!a) throw new BudgetError(`unknown agent ${agentId}`);
    return remainingBudget(a.budget);
  }

  /** Reserve budget from parent for a new child. Caller creates the child with allocated = amount. */
  reserveForChild(parentId: string, amount: number, allowZero = false) {
    const p = this.agents.get(parentId)!;
    if (allowZero && amount === 0) return;
    if (!(amount > 0)) throw new BudgetError('child budget must be positive');
    if (amount < this.opts.minChildBudgetUsd) throw new BudgetError(`child budget must be at least $${this.opts.minChildBudgetUsd}`);
    if (amount > this.remaining(parentId) + 1e-9) throw new BudgetError(`insufficient budget: need $${amount.toFixed(2)}, have $${this.remaining(parentId).toFixed(2)}`);
    p.budget.allocatedToChildren = round(p.budget.allocatedToChildren + amount);
  }

  /** Undo a reservation (spawn failed after reservation). */
  releaseChildReservation(parentId: string, amount: number) {
    const p = this.agents.get(parentId)!;
    p.budget.allocatedToChildren = round(p.budget.allocatedToChildren - amount);
  }

  transfer(fromId: string, toId: string, amount: number) {
    if (!(amount > 0)) throw new BudgetError('transfer amount must be positive');
    if (fromId === toId) throw new BudgetError('cannot transfer to self');
    const from = this.agents.get(fromId);
    const to = this.agents.get(toId);
    if (!from || !to) throw new BudgetError('unknown agent');
    if (to.status === 'terminated') throw new BudgetError('recipient is terminated');
    if (amount > this.remaining(fromId) + 1e-9) throw new BudgetError(`insufficient budget: need $${amount.toFixed(2)}, have $${this.remaining(fromId).toFixed(2)}`);
    from.budget.transferredOut = round(from.budget.transferredOut + amount);
    to.budget.transferredIn = round(to.budget.transferredIn + amount);
  }

  /** Charge LLM usage. May drive remaining slightly negative if a run overshoots; that agent becomes exhausted. */
  chargeLlm(agentId: string, usd: number) {
    const a = this.agents.get(agentId)!;
    a.budget.spentLlm = round(a.budget.spentLlm + Math.max(0, usd));
  }

  chargeFee(agentId: string, usd: number, _reason: string) {
    if (usd <= 0) return;
    if (usd > this.remaining(agentId) + 1e-9) throw new BudgetError(`insufficient budget for fee $${usd.toFixed(2)}`);
    const a = this.agents.get(agentId)!;
    a.budget.spentFees = round(a.budget.spentFees + usd);
  }

  /** On termination, unspent budget flows back to the parent (if any). Returns refunded amount. */
  refundToParent(agentId: string): number {
    const a = this.agents.get(agentId)!;
    const rem = this.remaining(agentId);
    if (rem <= 0 || !a.parentId) return 0;
    const p = this.agents.get(a.parentId)!;
    a.budget.transferredOut = round(a.budget.transferredOut + rem);
    p.budget.transferredIn = round(p.budget.transferredIn + rem);
    return rem;
  }

  /** Global conservation check (for tests and periodic self-audit). */
  audit(): { rootAllocated: number; accounted: number; ok: boolean } {
    let rootAllocated = 0;
    let accounted = 0;
    for (const a of this.agents.values()) {
      if (!a.parentId) rootAllocated += a.budget.allocated;
      accounted += remainingBudget(a.budget) + a.budget.spentLlm + a.budget.spentFees;
    }
    // Reservations that were refunded land as transfers; allocatedToChildren stays as the parent's outflow
    // and the child's allocation as inflow, so they cancel in `accounted`.
    rootAllocated = round(rootAllocated + this.externalInflow);
    return { rootAllocated, accounted: round(accounted), ok: Math.abs(rootAllocated - accounted) < 1e-6 };
  }
}

export const round = (n: number) => Math.round(n * 1e6) / 1e6;
