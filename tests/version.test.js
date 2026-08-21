import { describe, expect, test } from 'vite-plus/test';
import { ARTIFACT_STUDIO_VERSION } from '../src/version.js';

describe('Artifact Studio version', () => {
  test('uses YYYY.M.PATCH CalVer', () => {
    expect(ARTIFACT_STUDIO_VERSION).toMatch(/^\d{4}\.(?:[1-9]|1[0-2])\.\d+$/);
  });
});
