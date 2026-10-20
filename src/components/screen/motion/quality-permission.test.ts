import { describe, it, expect } from 'vitest';
import { localQualityPermission, resolveQualityMode } from './quality-permission';

describe('quality permission requires a verified server request boundary', () => {
  it.each([undefined, false, null, 0, 1, 'true', {}])('never treats %s as an attestation', proof => {
    for (const mode of ['candidate', 'shadow']) {
      const params = { debug: '1', qualityExperiment: mode };
      expect(resolveQualityMode(params, 'local-candidate', 'localhost:3081', proof as boolean)).toBe('baseline');
      expect(localQualityPermission('local-candidate', '127.0.0.1:3081', proof as boolean)).toBe(false);
    }
  });
  it('defaults to deny even with both a valid permission and loopback-looking Host', () => {
    for (const host of ['localhost', '127.0.0.1:3081', '[::1]:3081']) {
      expect(resolveQualityMode({ debug: '1', qualityExperiment: 'candidate' }, 'local-candidate', host)).toBe('baseline');
    }
  });
  it.each([undefined, '', 'true', 'candidate', 'local-candidate ', 'LOCAL-CANDIDATE', 'invalid'])('rejects invalid permission %s on an attested service', grant => {
    for (const mode of ['candidate', 'shadow']) expect(resolveQualityMode({ debug: '1', qualityExperiment: mode }, grant, 'localhost:3081', true)).toBe('baseline');
  });
  it('does not turn shadow permission into Candidate or manual control permission', () => {
    expect(resolveQualityMode({ debug: '1', qualityExperiment: 'shadow' }, 'local-shadow', 'localhost:3081', true)).toBe('shadow');
    expect(resolveQualityMode({ debug: '1', qualityExperiment: 'candidate' }, 'local-shadow', 'localhost:3081', true)).toBe('baseline');
  });
});
