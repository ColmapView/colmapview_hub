import { DurableObject } from 'cloudflare:workers';
import { randomValue, seal, unseal } from './crypto';
import { AccountError, accountReply, SESSION_SECONDS, TRANSACTION_SECONDS, type AccountProvider, type AccountPurpose, type AccountTokens, type AccountTransaction, type RememberedBucket } from './model';
import { exchangeAccountCode, refreshAccount } from './providers';
import { signBucketRequest } from './bucket';

type Row = { key: string; version: string; value: string; expires: number };
type Renewed = { tokens: AccountTokens; version: string };
const accountKey = (provider: AccountProvider, purpose: AccountPurpose) => `account:${provider}:${purpose}`;

/** One object per signed browser session: isolated encrypted credentials and serialized token renewal. */
export class AccountSession extends DurableObject<Env> {
  private refreshing = new Map<string, Promise<Renewed>>();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.ctx.blockConcurrencyWhile(async () => {
      this.ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS account_records (key TEXT PRIMARY KEY, version TEXT NOT NULL, value TEXT NOT NULL, expires INTEGER NOT NULL)');
      this.ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS account_lifetime (singleton INTEGER PRIMARY KEY CHECK(singleton = 1), expires INTEGER NOT NULL, epoch INTEGER NOT NULL)');
    });
  }

  private context(key: string) { return `${this.ctx.id.toString()}:${key}:v1`; }
  private expiry() { return this.ctx.storage.sql.exec<{ expires: number }>('SELECT expires FROM account_lifetime WHERE singleton = 1').toArray()[0]?.expires ?? 0; }
  private epoch() { return this.ctx.storage.sql.exec<{ epoch: number }>('SELECT epoch FROM account_lifetime WHERE singleton = 1').toArray()[0]?.epoch ?? 0; }
  private row(key: string): Row | undefined {
    if (this.expiry() <= Date.now()) return undefined;
    return this.ctx.storage.sql.exec<Row>('SELECT * FROM account_records WHERE key = ? AND expires > ?', key, Date.now()).toArray()[0];
  }
  private async read<T>(key: string): Promise<T | null> {
    const row = this.row(key);
    return row ? unseal<T>(this.env.AUTH_KEY, this.context(key), row.value) : null;
  }
  private async write(key: string, value: unknown, expires = this.expiry()): Promise<void> {
    const epoch = this.epoch();
    const encrypted = await seal(this.env.AUTH_KEY, this.context(key), value);
    if (expires <= Date.now() || this.expiry() <= Date.now() || this.epoch() !== epoch) throw new AccountError(401, 'This connection expired. Reconnect to continue.');
    this.ctx.storage.sql.exec('INSERT OR REPLACE INTO account_records VALUES (?, ?, ?, ?)', key, randomValue(), encrypted, expires);
    await this.armAlarm();
  }
  private async armAlarm() {
    const next = this.ctx.storage.sql.exec<{ expires: number }>('SELECT MIN(expires) AS expires FROM (SELECT expires FROM account_lifetime UNION ALL SELECT expires FROM account_records)').toArray()[0]?.expires;
    if (next) await this.ctx.storage.setAlarm(Math.max(Date.now() + 1000, next));
  }

  private async initializeValue(): Promise<number> {
    if (this.expiry() <= Date.now()) {
      this.ctx.storage.sql.exec('DELETE FROM account_records');
      this.ctx.storage.sql.exec('INSERT OR REPLACE INTO account_lifetime VALUES (1, ?, ?)', Date.now() + SESSION_SECONDS * 1000, this.epoch() + 1);
      await this.armAlarm();
    }
    return Math.floor((this.expiry() - Date.now()) / 1000);
  }

  private async beginValue(transaction: AccountTransaction): Promise<void> {
    const key = `transaction:${transaction.provider}`;
    const intent = `intent:${transaction.provider}`;
    const expires = Math.min(this.expiry(), Date.now() + TRANSACTION_SECONDS * 1000);
    this.ctx.storage.sql.exec('DELETE FROM account_records WHERE key = ? OR key = ?', key, `pending:${transaction.provider}`);
    this.ctx.storage.sql.exec('INSERT OR REPLACE INTO account_records VALUES (?, ?, ?, ?)', intent, transaction.state, '', expires);
    const encrypted = await seal(this.env.AUTH_KEY, this.context(key), transaction);
    if (this.row(intent)?.version !== transaction.state) throw new AccountError(401, 'Sign-in was cancelled.');
    this.ctx.storage.sql.exec('INSERT OR REPLACE INTO account_records VALUES (?, ?, ?, ?)', key, transaction.state, encrypted, expires);
    await this.armAlarm();
  }

  private async finishValue(provider: AccountProvider, query: string): Promise<{ transaction: AccountTransaction; error?: string }> {
    const key = `transaction:${provider}`;
    const row = this.row(key);
    if (!row) throw new AccountError(400, 'This sign-in expired. Return to ColmapView and try again.');
    const transaction = await unseal<AccountTransaction>(this.env.AUTH_KEY, this.context(key), row.value);
    const parameters = new URLSearchParams(query);
    if (parameters.getAll('state').length !== 1 || parameters.get('state') !== transaction.state || this.row(key)?.version !== row.version) {
      throw new AccountError(400, 'This sign-in response does not match the browser session.');
    }
    // Consume before contacting the provider. A pending revision prevents a late callback from undoing Disconnect.
    this.ctx.storage.sql.exec('DELETE FROM account_records WHERE key = ?', key);
    const pendingKey = `pending:${provider}`;
    const pending = transaction.state;
    this.ctx.storage.sql.exec('INSERT OR REPLACE INTO account_records VALUES (?, ?, ?, ?)', pendingKey, pending, '', Math.min(this.expiry(), Date.now() + TRANSACTION_SECONDS * 1000));
    try {
      if (parameters.has('error')) return { transaction, error: 'Sign-in was cancelled. You can try again.' };
      const tokens = await exchangeAccountCode(transaction, query, this.env);
      const encrypted = await seal(this.env.AUTH_KEY, this.context(accountKey(provider, transaction.purpose)), tokens);
      if (!pending || this.row(pendingKey)?.version !== pending || this.expiry() <= Date.now()) throw new AccountError(401, 'Sign-in was cancelled.');
      this.ctx.storage.sql.exec('INSERT OR REPLACE INTO account_records VALUES (?, ?, ?, ?)', accountKey(provider, transaction.purpose), transaction.state, encrypted,
        tokens.refreshToken ? this.expiry() : Math.min(this.expiry(), tokens.expiresAt));
      return { transaction };
    } catch (error) {
      return { transaction, error: error instanceof AccountError ? error.message : 'Could not authorize this account. Return to ColmapView and try again.' };
    } finally {
      if (this.row(pendingKey)?.version === pending) this.ctx.storage.sql.exec('DELETE FROM account_records WHERE key = ?', pendingKey);
      await this.armAlarm();
    }
  }

  private async summaryValue() {
    const accounts: { provider: AccountProvider; purpose: AccountPurpose; accountId: string; username?: string; renewable: boolean }[] = [];
    for (const provider of ['google', 'hf'] as const) for (const purpose of provider === 'google' ? ['view', 'install'] as const : ['view', 'publish'] as const) {
      const tokens = await this.read<AccountTokens>(accountKey(provider, purpose));
      if (tokens) accounts.push({ provider, purpose, accountId: tokens.subject, username: tokens.username, renewable: Boolean(tokens.refreshToken) });
    }
    const bucket = await this.read<RememberedBucket>('bucket');
    return { accounts, bucket: bucket ? { config: bucket.config, writable: bucket.writable } : null, expiresAt: this.expiry() };
  }

  private async renew(provider: AccountProvider, purpose: AccountPurpose, force: boolean): Promise<Renewed> {
    const key = accountKey(provider, purpose);
    const row = this.row(key);
    if (!row) throw new AccountError(401, 'Connect this account to continue.');
    let tokens = await unseal<AccountTokens>(this.env.AUTH_KEY, this.context(key), row.value);
    const version = row.version;
    if (force || tokens.expiresAt <= Date.now() + 30_000) {
      try {
        tokens = await refreshAccount(provider, purpose, tokens, this.env);
        const encrypted = await seal(this.env.AUTH_KEY, this.context(key), tokens);
        if (this.row(key)?.version !== row.version) throw new AccountError(401, 'This connection changed. Reconnect to continue.');
        this.ctx.storage.sql.exec('UPDATE account_records SET value = ? WHERE key = ?', encrypted, key);
      } catch (error) {
        if (error instanceof AccountError && [401, 403].includes(error.status) && this.row(key)?.version === row.version) this.ctx.storage.sql.exec('DELETE FROM account_records WHERE key = ?', key);
        throw error;
      }
    } else if (this.row(key)?.version !== row.version) throw new AccountError(401, 'This connection changed. Reconnect to continue.');
    return { tokens, version };
  }

  private async tokenValue(provider: AccountProvider, purpose: AccountPurpose, expectedAccount?: string, force = false) {
    // Installation does not grant additional dataset access; an installed Drive connection also serves normal file opens.
    let actualPurpose = purpose;
    if (provider === 'google' && purpose === 'view' && this.row(accountKey(provider, 'install'))) {
      const view = await this.read<AccountTokens>(accountKey(provider, 'view'));
      if (!view || (expectedAccount && view.subject !== expectedAccount)) {
        const installed = await this.read<AccountTokens>(accountKey(provider, 'install'));
        if (!expectedAccount || installed?.subject === expectedAccount) actualPurpose = 'install';
      }
    }
    const key = accountKey(provider, actualPurpose);
    let pending = this.refreshing.get(key);
    if (!pending) {
      pending = this.renew(provider, actualPurpose, force);
      this.refreshing.set(key, pending);
    }
    try {
      const { tokens, version } = await pending;
      if (this.row(key)?.version !== version) throw new AccountError(401, 'This connection ended.');
      if (expectedAccount && tokens.subject !== expectedAccount) throw new AccountError(409, 'Connect the Google account used to open this file.');
      // Refresh tokens never cross the Worker/browser boundary.
      return { accessToken: tokens.accessToken, expiresAt: tokens.expiresAt, scope: tokens.scope, accountId: tokens.subject,
        username: tokens.username, renewable: Boolean(tokens.refreshToken) };
    } finally { if (this.refreshing.get(key) === pending) this.refreshing.delete(key); }
  }

  private async rememberBucketValue(bucket: RememberedBucket) { await this.write('bucket', bucket); }
  private async enableBucketUploadsValue() {
    const row = this.row('bucket');
    if (!row) throw new AccountError(401, 'Connect this bucket to continue.');
    const bucket = await unseal<RememberedBucket>(this.env.AUTH_KEY, this.context('bucket'), row.value);
    const encrypted = await seal(this.env.AUTH_KEY, this.context('bucket'), { ...bucket, writable: true });
    if (this.row('bucket')?.version !== row.version) throw new AccountError(409, 'This bucket connection changed. Try again.');
    this.ctx.storage.sql.exec('UPDATE account_records SET value = ?, version = ? WHERE key = ?', encrypted, randomValue(), 'bucket');
  }
  private async signBucketValue(input: unknown) {
    const row = this.row('bucket');
    if (!row) throw new AccountError(401, 'Connect this bucket to continue.');
    const bucket = await unseal<RememberedBucket>(this.env.AUTH_KEY, this.context('bucket'), row.value);
    const result = await signBucketRequest(bucket, input);
    if (this.row('bucket')?.version !== row.version) throw new AccountError(401, 'This bucket connection ended.');
    return result;
  }
  private disconnectValue(provider: AccountProvider | 'bucket' | 'all') {
    this.ctx.storage.sql.exec('UPDATE account_lifetime SET epoch = epoch + 1 WHERE singleton = 1');
    if (provider === 'all') this.ctx.storage.sql.exec('DELETE FROM account_records');
    else if (provider === 'bucket') this.ctx.storage.sql.exec('DELETE FROM account_records WHERE key = ?', 'bucket');
    else this.ctx.storage.sql.exec('DELETE FROM account_records WHERE key LIKE ? OR key = ? OR key = ? OR key = ?', `account:${provider}:%`, `transaction:${provider}`, `pending:${provider}`, `intent:${provider}`);
  }
  private cancelValue(provider: AccountProvider, transactionId: string) {
    this.ctx.storage.sql.exec('DELETE FROM account_records WHERE version = ? AND (key LIKE ? OR key = ? OR key = ? OR key = ?)',
      transactionId, `account:${provider}:%`, `transaction:${provider}`, `pending:${provider}`, `intent:${provider}`);
  }

  // Return structured failures: RPC serializes Error objects without application-specific status fields.
  initialize() { return accountReply(() => this.initializeValue()); }
  begin(transaction: AccountTransaction) { return accountReply(() => this.beginValue(transaction)); }
  finish(provider: AccountProvider, query: string) { return accountReply(() => this.finishValue(provider, query)); }
  summary() { return accountReply(() => this.summaryValue()); }
  token(provider: AccountProvider, purpose: AccountPurpose, expectedAccount?: string, force = false) { return accountReply(() => this.tokenValue(provider, purpose, expectedAccount, force)); }
  rememberBucket(bucket: RememberedBucket) { return accountReply(() => this.rememberBucketValue(bucket)); }
  enableBucketUploads() { return accountReply(() => this.enableBucketUploadsValue()); }
  signBucket(input: unknown) { return accountReply(() => this.signBucketValue(input)); }
  disconnect(provider: AccountProvider | 'bucket' | 'all') { return accountReply(() => this.disconnectValue(provider)); }
  cancel(provider: AccountProvider, transactionId: string) { return accountReply(() => this.cancelValue(provider, transactionId)); }

  async alarm() {
    if (this.expiry() <= Date.now()) {
      this.ctx.storage.sql.exec('DELETE FROM account_records');
      this.ctx.storage.sql.exec('DELETE FROM account_lifetime');
      await this.ctx.storage.deleteAlarm();
    } else {
      this.ctx.storage.sql.exec('DELETE FROM account_records WHERE expires <= ?', Date.now());
      await this.armAlarm();
    }
  }
}
