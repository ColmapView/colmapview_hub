import { runDurableObjectAlarm, runInDurableObject } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clientNetwork, hash } from '../src/worker/crypto';
import { BLOCK_MS, MISS_WINDOW_MS, REFUSAL_FLOOR_MS, type GuardState } from '../src/worker/guard';
import { create, guard, input, ip, request, resetState } from './helpers';

beforeEach(async () => {
  await resetState();
  vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Unexpected external request'));
});
afterEach(() => { vi.restoreAllMocks(); });

const storage = async (clientIp = ip) => runInDurableObject(await guard(clientIp), async (_, state) => ({
  keys: [...state.storage.kv.list()].map(([key]) => key),
  state: state.storage.kv.get<GuardState>('state'),
  alarm: await state.storage.getAlarm(),
}));

function countingGuards() {
  const calls: string[] = [];
  const stub = {
    lookup: async (miss: string | null) => { calls.push(miss === null ? 'lookup' : 'lookup-miss'); return 0; },
    admitCreation: async () => { calls.push('admitCreation'); return 0; },
  };
  return { calls, overrides: { LOOKUP_GUARDS: { getByName: () => stub } as unknown as Env['LOOKUP_GUARDS'] } };
}

describe('lookup guard', () => {
  it('keeps no storage for a client that only finds links', async () => {
    const link = await create(input());
    for (const path of [`/${link.id}`, `/${link.id}/preview.jpg`]) {
      for (const method of ['GET', 'HEAD']) expect((await request(path, { method }, '192.0.2.9')).status).toBe(200);
    }
    expect(await storage('192.0.2.9')).toEqual({ keys: [], state: undefined, alarm: null });
  });

  it('writes each new miss once, ignores repeats, and keeps the alarm on the earliest expiry', async () => {
    await request('/missing'); await request('/missing/preview.jpg'); await request('/missing', { method: 'HEAD' });
    const first = await storage();
    expect(Object.keys(first.state!.misses)).toHaveLength(1);
    expect(Object.keys(first.state!.misses)).toEqual([await hash('missing')]);
    const firstExpiry = Object.values(first.state!.misses)[0] + MISS_WINDOW_MS;
    expect(first.alarm).toBe(firstExpiry);
    await request('/another');
    const second = await storage();
    expect(Object.keys(second.state!.misses)).toHaveLength(2);
    expect(second.alarm).toBe(firstExpiry);
  });

  it('records a miss whose fingerprint matches an inherited property name', async () => {
    expect(await (await guard()).lookup('constructor')).toBe(0);
    expect(Object.keys((await storage()).state?.misses ?? {})).toEqual(['constructor']);
  });

  it('blocks on the third distinct miss, drops the misses, and wakes at the block end', async () => {
    await request('/one'); await request('/two');
    expect((await request('/three')).status).toBe(429);
    const { state, alarm } = await storage();
    expect(state!.misses).toEqual({});
    expect(state!.blockedUntil! - Date.now()).toBeGreaterThan(BLOCK_MS - 60_000);
    expect(alarm).toBe(state!.blockedUntil);
  });

  it('holds refusals until the floor, whether or not the guess names a record', async () => {
    const link = await create(input());
    await request('/one'); await request('/two'); await request('/three');
    for (const path of [`/${link.id}`, '/MissingName']) {
      const before = Date.now();
      expect((await request(path)).status, path).toBe(429);
      expect(Date.now() - before, path).toBeGreaterThanOrEqual(REFUSAL_FLOOR_MS);
    }
  });

  it('deletes all storage when the alarm finds nothing pending', async () => {
    await request('/one');
    await runInDurableObject(await guard(), async (_, state) => {
      state.storage.kv.put('state', { misses: { stale: Date.now() - MISS_WINDOW_MS - 1 } } satisfies GuardState);
      await state.storage.setAlarm(Date.now() + 60_000);
    });
    expect(await runDurableObjectAlarm(await guard())).toBe(true);
    expect(await storage()).toEqual({ keys: [], state: undefined, alarm: null });
  });

  it('keeps pending entries through the alarm and re-arms it', async () => {
    const live = Date.now();
    await request('/one');
    await runInDurableObject(await guard(), async (_, state) => {
      state.storage.kv.put('state', { misses: { stale: live - MISS_WINDOW_MS - 1, fresh: live } } satisfies GuardState);
      await state.storage.setAlarm(Date.now() + 60_000);
    });
    expect(await runDurableObjectAlarm(await guard())).toBe(true);
    const { state, alarm } = await storage();
    expect(state).toEqual({ misses: { fresh: live } });
    expect(alarm).toBe(live + MISS_WINDOW_MS);
  });

  it('calls the guard once per request', async () => {
    const link = await create(input());
    const guards = countingGuards();
    const cases: Array<[string, RequestInit, string[]]> = [
      [`/${link.id}`, {}, ['lookup']], [`/${link.id}/preview.jpg`, {}, ['lookup']], ['/', {}, ['lookup']], ['/missing', {}, ['lookup-miss']],
      [`/api/links/${link.id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${'B'.repeat(43)}` } }, ['lookup-miss']],
      ['/api/links', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input({ managementSecret: 'C'.repeat(43) })) }, ['admitCreation']],
    ];
    for (const [path, init, expected] of cases) {
      guards.calls.length = 0;
      await request(path, init, ip, guards.overrides);
      expect(guards.calls, path).toEqual(expected);
    }
  });

  it('groups IPv6 clients by their /64 network and IPv4-mapped clients with IPv4', async () => {
    expect((await request('/one', {}, '2001:db8:1:2::1')).status).toBe(404);
    expect((await request('/two', {}, '2001:DB8:1:2:aaaa::2')).status).toBe(404);
    expect((await request('/three', {}, '2001:0db8:0001:0002:0000:0000:0000:0003')).status).toBe(429);
    expect((await request('/one', {}, '2001:db8:1:3::1')).status).toBe(404);
    expect((await request('/one', {}, '198.51.100.7')).status).toBe(404);
    expect((await request('/two', {}, '::ffff:198.51.100.7')).status).toBe(404);
    expect((await request('/three', {}, '::FFFF:c633:6407')).status).toBe(429);
  });

  it.each([
    ['2001:db8::1', '2001:db8:0:0::/64'],
    ['2001:0DB8:0000:0000:0000:0000:0000:0002', '2001:db8:0:0::/64'],
    ['2001:db8:1:2:aaaa::2', '2001:db8:1:2::/64'],
    ['::1', '0:0:0:0::/64'],
    ['::ffff:192.0.2.1', '192.0.2.1'],
    ['::ffff:c000:201', '192.0.2.1'],
    ['192.0.2.1', '192.0.2.1'],
    ['not-an-address', 'not-an-address'],
    ['1::2::3', '1::2::3'],
    ['fe80::1%eth0', 'fe80::1%eth0'],
    ['::ffff:256.0.0.1', '::ffff:256.0.0.1'],
    ['64:ff9b::192.0.2.1', '64:ff9b:0:0::/64'],
    ['1:2:3:4:5:6:7:8:9', '1:2:3:4:5:6:7:8:9'],
  ])('maps %s to the network %s', (address, network) => expect(clientNetwork(address)).toBe(network));

  it('counts letter-case variants of one guess once, but not changes inside a long suffix', async () => {
    await request('/funnyball'); await request('/FUNNYBALL'); await request('/FunnyBall');
    expect(Object.keys((await storage()).state!.misses)).toHaveLength(1);
    await request('/FunnyBall-AAAAAAAAAAAAAAAA');
    expect((await request('/FunnyBall-aaaaaaaaaaaaaaaa')).status).toBe(429);
  });
});
