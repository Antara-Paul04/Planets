// Deterministic stub providers for tests and keyless local development
// (MODERATION_MOCK=1). Behavior is driven by markers in the submission name,
// so every decision path can be exercised end-to-end without credentials:
//   __unsafe_image__    -> image scores high        -> REJECTED
//   __odd_image__       -> image scores mid         -> REVIEW
//   __unsafe_text__     -> OCR finds vile text      -> REJECTED
//   __edgy_text__       -> OCR finds borderline     -> REVIEW
//   __ocr_fail__        -> OCR provider throws      -> REVIEW (fail closed)
//   __image_fail__      -> image provider throws    -> REVIEW (fail closed)
//   anything else       -> everything clean         -> APPROVED

export function mockProviders(context) {
  const name = (context && context.name) || '';
  return {
    image: {
      name: 'mock-image',
      async moderate() {
        if (name.includes('__image_fail__')) throw new Error('mock_image_failure');
        if (name.includes('__unsafe_image__')) {
          return { ok: true, score: 0.96, categories: { violence: 0.96 }, provider: 'mock-image' };
        }
        if (name.includes('__odd_image__')) {
          return { ok: true, score: 0.55, categories: { violence: 0.55 }, provider: 'mock-image' };
        }
        return { ok: true, score: 0.02, categories: {}, provider: 'mock-image' };
      },
    },
    ocr: {
      name: 'mock-ocr',
      async extractText() {
        if (name.includes('__ocr_fail__')) throw new Error('mock_ocr_failure');
        if (name.includes('__unsafe_text__')) {
          return { ok: true, text: 'mock-vile-text', confidence: 0.9, provider: 'mock-ocr' };
        }
        if (name.includes('__edgy_text__')) {
          return { ok: true, text: 'mock-edgy-text', confidence: 0.6, provider: 'mock-ocr' };
        }
        return { ok: true, text: '', confidence: 0.9, provider: 'mock-ocr' };
      },
    },
    text: {
      name: 'mock-text',
      async moderate(text) {
        if (text.includes('mock-vile-text')) {
          return { ok: true, score: 0.97, categories: { hate: 0.97 }, provider: 'mock-text' };
        }
        if (text.includes('mock-edgy-text')) {
          return { ok: true, score: 0.6, categories: { harassment: 0.6 }, provider: 'mock-text' };
        }
        return { ok: true, score: 0.01, categories: {}, provider: 'mock-text' };
      },
    },
  };
}
