import { describe, expect, it } from 'vitest';
import * as mod from '../src/worker/index';

describe('worker module exports', () => {
  // workerd refuses to boot a module whose named exports are not classes or functions.
  it('exports only classes or functions besides the default handler', () => {
    for (const [name, value] of Object.entries(mod)) {
      if (name === 'default') expect(typeof (value as ExportedHandler).fetch, name).toBe('function');
      else expect(typeof value, name).toBe('function');
    }
    expect(Object.keys(mod).sort()).toEqual(['LookupGuard', 'default']);
  });
});
