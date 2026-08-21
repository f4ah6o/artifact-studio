import { describe, expect, test } from 'vite-plus/test';
import { AS_CODE_STUDIO_VERSION } from '../src/version.js';

describe('As-Code Studio version', () => {
  test('uses YYYY.M.PATCH CalVer', () => {
    expect(AS_CODE_STUDIO_VERSION).toMatch(/^\d{4}\.(?:[1-9]|1[0-2])\.\d+$/);
  });
});
