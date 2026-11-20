import { describe, expect, it } from 'vitest';
import { captionLostChunk } from './controller.js';

describe('captionLostChunk', () => {
  const full = 'ನೀವು ನೋಡುತ್ತಿರುವ ಅಡುಗೆಮನೆ 201 ಚದರ ಅಡಿ ವಿಸ್ತಾರದಲ್ಲಿದ್ದು, ಮರದ ಕ್ಯಾಬಿನೆಟ್‌ಗಳಿವೆ. ಇದರಲ್ಲಿ ಹಾಬ್ ಇದೆ.';
  it('recognises a caption that lost a middle chunk', () => {
    const cut = 'ನೀವು ನೋಡುತ್ತಿರುವ ಅಡುಗೆಮನೆ 201 ಚದರ ಅಡಿ ವಿಸ್ತಾರದಲ್ಲಿದ್ದು,ಿನೆಟ್‌ಗಳಿವೆ. ಇದರಲ್ಲಿ ಹಾಬ್ ಇದೆ.';
    expect(captionLostChunk(cut, full)).toBe(true);
  });
  it('leaves complete captions and unrelated replies alone', () => {
    expect(captionLostChunk(full, full)).toBe(false);
    expect(captionLostChunk('This is the kitchen with wood cabinets.', full)).toBe(false);
    expect(captionLostChunk('Okay.', 'Okay. Let me show you the kitchen now.')).toBe(false);
  });
});
