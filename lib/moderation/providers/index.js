// Provider selection. The rest of the application only ever sees the
// normalized interfaces:
//   ImageModerator: { moderate(imageDataURL) -> {ok, score, categories, provider} }
//   OCRProvider:    { extractText(imageDataURL) -> {ok, text, confidence, provider} }
//   TextModerator:  { moderate(text) -> {ok, score, categories, provider} }
// Swap providers here; nothing else changes.

import { openaiImageModerator, openaiTextModerator, openaiOcrProvider } from './openai.js';
import { googleOcrProvider } from './google.js';
import { mockProviders } from './mock.js';

export function getProviders(cfg, context = {}) {
  if (cfg.mock) return mockProviders(context);

  if (!cfg.openaiKey) return null; // not configured -- caller fails closed

  return {
    image: openaiImageModerator(cfg),
    // Google Vision handles classic handwriting OCR when configured;
    // otherwise OpenAI vision transcription covers the same role
    ocr: cfg.googleVisionKey ? googleOcrProvider(cfg) : openaiOcrProvider(cfg),
    text: openaiTextModerator(cfg),
  };
}
