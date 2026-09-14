import { EventEmitter } from 'node:events';
import { newId } from './ids.js';
import type { ExperimentStore } from './store/db.js';
import type { EventType, SocietyEvent } from './types.js';

/** Persist-then-publish event bus. Every significant state change goes through here. */
export class EventBus extends EventEmitter {
  constructor(private store: ExperimentStore) { super(); this.setMaxListeners(100); }

  emitEvent(type: EventType, agentId: string | null, data: Record<string, unknown> = {}): SocietyEvent {
    const ev = this.store.appendEvent({ id: newId('ev'), ts: Date.now(), type, agentId, data });
    this.emit('event', ev);
    return ev;
  }

  onEvent(fn: (e: SocietyEvent) => void) { this.on('event', fn); return () => this.off('event', fn); }
}
