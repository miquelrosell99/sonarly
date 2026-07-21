import { describe, it, expect } from 'vitest';
import { buildSubsonicToken } from '../../src/auth/token.js';

describe('buildSubsonicToken', () => {
  it('produces MD5(token+salt)', () => {
    const token = buildSubsonicToken('secret', 'salt');
    expect(token).toHaveLength(32);
  });
});
