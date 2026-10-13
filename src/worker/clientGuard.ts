import { DurableObject } from 'cloudflare:workers';

const WINDOW_MS = 10 * 60 * 1000;
const CREATE_WINDOW_MS = 60 * 60 * 1000;
const MAX_CREATES = 20;

type GuardState = {
  blockedUntil: number;
  creationStarted: number;
  creationCount: number;
};

export class ClientGuard extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS misses (fingerprint TEXT PRIMARY KEY, at INTEGER NOT NULL)');
    ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS guard (id INTEGER PRIMARY KEY CHECK(id = 1), blockedUntil INTEGER NOT NULL, creationStarted INTEGER NOT NULL, creationCount INTEGER NOT NULL)');
    ctx.storage.sql.exec('INSERT OR IGNORE INTO guard VALUES (1, 0, 0, 0)');
  }

  private state(now: number): GuardState {
    this.ctx.storage.sql.exec('DELETE FROM misses WHERE at <= ?', now - WINDOW_MS);
    this.ctx.storage.sql.exec('UPDATE guard SET blockedUntil = 0 WHERE blockedUntil <= ?', now);
    this.ctx.storage.sql.exec('UPDATE guard SET creationStarted = 0, creationCount = 0 WHERE creationStarted <= ?', now - CREATE_WINDOW_MS);
    return this.ctx.storage.sql.exec<GuardState>('SELECT blockedUntil, creationStarted, creationCount FROM guard WHERE id = 1').one();
  }

  check(): number {
    const now = Date.now();
    return Math.max(0, Math.ceil((this.state(now).blockedUntil - now) / 1000));
  }

  async finishLookup(missFingerprint: string | null): Promise<number> {
    const now = Date.now();
    const result = this.ctx.storage.transactionSync(() => {
      const state = this.state(now);
      if (state.blockedUntil > now) return Math.ceil((state.blockedUntil - now) / 1000);
      if (missFingerprint !== null) {
        this.ctx.storage.sql.exec('INSERT OR IGNORE INTO misses VALUES (?, ?)', missFingerprint, now);
        const { count } = this.ctx.storage.sql.exec<{ count: number }>('SELECT COUNT(*) AS count FROM misses').one();
        if (count >= 3) {
          this.ctx.storage.sql.exec('UPDATE guard SET blockedUntil = ? WHERE id = 1', now + WINDOW_MS);
          return WINDOW_MS / 1000;
        }
      }
      return 0;
    });
    await this.scheduleCleanup();
    return result;
  }

  async admitCreation(): Promise<number> {
    const now = Date.now();
    const result = this.ctx.storage.transactionSync(() => {
      const state = this.state(now);
      if (state.blockedUntil > now) return Math.ceil((state.blockedUntil - now) / 1000);
      if (state.creationCount >= MAX_CREATES) return Math.ceil((state.creationStarted + CREATE_WINDOW_MS - now) / 1000);
      this.ctx.storage.sql.exec('UPDATE guard SET creationStarted = ?, creationCount = ? WHERE id = 1', state.creationStarted || now, state.creationCount + 1);
      return 0;
    });
    await this.scheduleCleanup();
    return result;
  }

  private expiresAt(): number {
    const state = this.ctx.storage.sql.exec<GuardState>('SELECT blockedUntil, creationStarted, creationCount FROM guard WHERE id = 1').one();
    const { earliest } = this.ctx.storage.sql.exec<{ earliest: number | null }>('SELECT MIN(at) AS earliest FROM misses').one();
    const expiries = [state.blockedUntil, state.creationStarted ? state.creationStarted + CREATE_WINDOW_MS : 0, earliest === null ? 0 : earliest + WINDOW_MS].filter(value => value > 0);
    return expiries.length ? Math.min(...expiries) : 0;
  }

  private async scheduleCleanup(): Promise<void> {
    const expiry = this.expiresAt();
    if (expiry) await this.ctx.storage.setAlarm(expiry);
  }

  async alarm(): Promise<void> {
    this.state(Date.now());
    const expiry = this.expiresAt();
    if (expiry > Date.now()) await this.ctx.storage.setAlarm(expiry);
    else {
      this.ctx.storage.sql.exec('DELETE FROM misses');
      this.ctx.storage.sql.exec('UPDATE guard SET blockedUntil = 0, creationStarted = 0, creationCount = 0 WHERE id = 1');
    }
  }
}
