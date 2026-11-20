import { describe, expect, it } from 'vitest';
import { placeLabels, type LabelCandidate } from './labels';

const VIEW = { width: 800, height: 600 };
const label = (id: string, x: number, y: number, priority: number, width = 120): LabelCandidate => ({ id, x, y, width, height: 24, priority });

describe('placeLabels', () => {
  it('shows every label when nothing collides', () => {
    const shown = placeLabels([label('a', 100, 100, 1), label('b', 100, 300, 2)], VIEW);
    expect([...shown].sort()).toEqual(['a', 'b']);
  });

  it('lets the higher-priority label win a collision', () => {
    const shown = placeLabels([label('far', 100, 100, 5), label('near', 100, 110, 1)], VIEW);
    expect(shown.has('near')).toBe(true);
    expect(shown.has('far')).toBe(false);
  });

  it('never covers another pin with a label', () => {
    // b's pin sits right where a's label would go.
    const shown = placeLabels([label('a', 100, 100, 1), label('b', 160, 100, 2, 40)], VIEW);
    expect(shown.has('a')).toBe(false);
    expect(shown.has('b')).toBe(true);
  });

  it('hides labels that would run off screen and respects obstacles', () => {
    expect(placeLabels([label('edge', 780, 100, 1)], VIEW).size).toBe(0);
    const obstacle = { left: 110, top: 80, right: 300, bottom: 120 };
    expect(placeLabels([label('a', 100, 100, 1)], VIEW, [obstacle]).size).toBe(0);
  });
});
