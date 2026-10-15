import { DurableObject } from 'cloudflare:workers';

export const MISS_WINDOW_MS = 10 * 60 * 1000;
export const BLOCK_MS = 10 * 60 * 1000;
export const CREATE_WINDOW_MS = 60 * 60 * 1000;
export const MAX_MISSES = 3;
export const VERIFIED_BOT_MAX_MISSES = 30;
export const MAX_CREATES = 20;
/** A refusal leaves no sooner than this after the request arrived, so its timing normally doesn't show whether a guess read a record (a read slower than 500 ms can). */
export const REFUSAL_FLOOR_MS = 500;
const STATE_KEY = 'state';

/** Distinct miss fingerprints with first-seen times, an active block, and the creation window. */
export interface GuardState {
  misses: Record<string, number>;
  blockedUntil?: number;
  creations?: { started: number; count: number };
}

/** The stored state without expired entries. */
function liveState(stored: GuardState | undefined, now: number): GuardState {
  return {
    misses: Object.fromEntries(Object.entries(stored?.misses ?? {}).filter(([, at]) => at + MISS_WINDOW_MS > now)),
    ...(stored?.blockedUntil && stored.blockedUntil > now ? { blockedUntil: stored.blockedUntil } : {}),
    ...(stored?.creations && stored.creations.started + CREATE_WINDOW_MS > now ? { creations: stored.creations } : {}),
  };
}

function nextExpiry(state: GuardState | undefined): number | null {
  if (!state) return null;
  const times = [...Object.values(state.misses).map(at => at + MISS_WINDOW_MS), ...(state.blockedUntil ? [state.blockedUntil] : []),
    ...(state.creations ? [state.creations.started + CREATE_WINDOW_MS] : [])];
  return times.length ? Math.min(...times) : null;
}

const isEmpty = (state: GuardState) => !Object.keys(state.misses).length && !state.blockedUntil && !state.creations;
const secondsUntil = (time: number, now: number) => Math.max(1, Math.ceil((time - now) / 1000));

/** Per-client lookup and creation limits. A client with nothing pending keeps no storage. */
export class LookupGuard extends DurableObject<Env> {
  /** One call per lookup, made after the record read: the wait in seconds, or 0. A hit writes nothing. */
  async lookup(missFingerprint: string | null, maxMisses: number = MAX_MISSES): Promise<number> {
    const now = Date.now();
    const stored = this.ctx.storage.kv.get<GuardState>(STATE_KEY);
    const state = liveState(stored, now);
    if (state.blockedUntil) return secondsUntil(state.blockedUntil, now);
    if (missFingerprint === null || Object.hasOwn(state.misses, missFingerprint)) return 0;
    const misses = { ...state.misses, [missFingerprint]: now };
    const next: GuardState = Object.keys(misses).length >= maxMisses
      ? { misses: {}, blockedUntil: now + BLOCK_MS, ...(state.creations ? { creations: state.creations } : {}) }
      : { ...state, misses };
    await this.save(stored, next);
    return next.blockedUntil ? secondsUntil(next.blockedUntil, now) : 0;
  }

  /** The creation quota; also refuses blocked clients. */
  async admitCreation(): Promise<number> {
    const now = Date.now();
    const stored = this.ctx.storage.kv.get<GuardState>(STATE_KEY);
    const state = liveState(stored, now);
    if (state.blockedUntil) return secondsUntil(state.blockedUntil, now);
    if (state.creations && state.creations.count >= MAX_CREATES) return secondsUntil(state.creations.started + CREATE_WINDOW_MS, now);
    await this.save(stored, { ...state, creations: { started: state.creations?.started ?? now, count: (state.creations?.count ?? 0) + 1 } });
    return 0;
  }

  async alarm(): Promise<void> {
    const state = liveState(this.ctx.storage.kv.get<GuardState>(STATE_KEY), Date.now());
    // At compatibility date 2026-02-24 and later, deleteAll() also removes the alarm.
    if (isEmpty(state)) { await this.ctx.storage.deleteAll(); return; }
    this.ctx.storage.kv.put(STATE_KEY, state);
    await this.ctx.storage.setAlarm(nextExpiry(state)!);
  }

  /** Callers save only changed state; the alarm moves only when the earliest expiry moves. */
  private async save(stored: GuardState | undefined, next: GuardState): Promise<void> {
    this.ctx.storage.kv.put(STATE_KEY, next);
    const expiry = nextExpiry(next);
    if (expiry !== null && expiry !== nextExpiry(stored)) await this.ctx.storage.setAlarm(expiry);
  }
}
