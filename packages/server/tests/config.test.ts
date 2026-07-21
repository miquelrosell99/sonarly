import { describe, it, expect } from 'vitest';
import { loadConfig } from '../src/config.js';

describe('loadConfig', () => {
  it('uses defaults when env has SESSION_SECRET', () => {
    process.env.SESSION_SECRET = 'a'.repeat(32);
    const config = loadConfig();
    expect(config.PORT).toBe(3000);
    expect(config.LIBRARY_PATH).toBe('/data/library');
    delete process.env.SESSION_SECRET;
  });

  it('throws when SESSION_SECRET is missing', () => {
    expect(() => loadConfig()).toThrow();
  });
});
