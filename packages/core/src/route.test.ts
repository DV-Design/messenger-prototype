import { describe, expect, it } from 'vitest';
import { classifyRoute } from './session.js';

const report = (entries: Record<string, unknown>[]) => {
  const map = new Map(entries.map(entry => [entry.id as string, entry]));
  return { forEach: (fn: (value: unknown) => void) => map.forEach(value => fn(value)), get: (id: string) => map.get(id) };
};
const pair = { id: 'p', type: 'candidate-pair', state: 'succeeded', nominated: true, localCandidateId: 'l', remoteCandidateId: 'r' };

describe('route classification for direct-only files', () => {
  it('calls a pair direct only when both candidates are known and neither is a relay', () => {
    expect(classifyRoute(report([pair, { id: 'l', candidateType: 'host' }, { id: 'r', candidateType: 'srflx' }])).route).toBe('direct');
    expect(classifyRoute(report([pair, { id: 'l', candidateType: 'relay' }, { id: 'r', candidateType: 'host' }])).route).toBe('relay');
  });
  it('treats missing candidate details as unknown, never direct', () => {
    expect(classifyRoute(report([pair])).route).toBe('unknown');
    expect(classifyRoute(report([pair, { id: 'l', candidateType: 'host' }])).route).toBe('unknown');
    expect(classifyRoute(report([])).route).toBe('unknown');
  });
  it('prefers the transport-selected pair over another nominated one', () => {
    const relayed = { id: 'q', type: 'candidate-pair', state: 'succeeded', localCandidateId: 'l2', remoteCandidateId: 'r2' };
    const r = report([pair, relayed, { id: 't', type: 'transport', selectedCandidatePairId: 'q' }, { id: 'l', candidateType: 'host' }, { id: 'r', candidateType: 'host' }, { id: 'l2', candidateType: 'relay' }, { id: 'r2', candidateType: 'host' }]);
    expect(classifyRoute(r).route).toBe('relay');
  });
  it('is unknown while the selected pair has not succeeded', () => {
    const r = report([{ ...pair, state: 'in-progress' }, { id: 't', type: 'transport', selectedCandidatePairId: 'p' }, { id: 'l', candidateType: 'host' }, { id: 'r', candidateType: 'host' }]);
    expect(classifyRoute(r).route).toBe('unknown');
  });
});
