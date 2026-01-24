import { describe, it, expect } from 'vitest';

describe('Project Setup', () => {
  it('should have VERSION exported from main entry', async () => {
    const { VERSION } = await import('../../src/index.js');
    expect(VERSION).toBe('0.1.0');
  });
});
