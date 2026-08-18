// Combine the signals into one of three outcomes. The philosophy:
//   - one high-confidence unsafe signal (image OR text) -> REJECTED
//   - any mid-confidence signal, or any provider failure -> REVIEW (fail closed)
//   - everything clean -> APPROVED
// Weird-but-harmless art scores low on every harm category and sails through;
// nothing here penalizes strangeness.

export const APPROVED = 'approved';
export const REVIEW = 'review';
export const REJECTED = 'rejected';

// signals: {
//   image: { ok, score, categories } | null,
//   text:  { ok, score, categories } | null,   // covers OCR text + planet name
//   ocr:   { ok, text, confidence } | null,
//   failures: number,                          // provider errors/timeouts
// }
export function decide(signals, cfg) {
  const imageScore = signals.image && signals.image.ok ? signals.image.score : null;
  const textScore = signals.text && signals.text.ok ? signals.text.score : null;

  // high-confidence unsafe wins regardless of anything else
  if (imageScore !== null && imageScore >= cfg.imageReject) return REJECTED;
  if (textScore !== null && textScore >= cfg.textReject) return REJECTED;

  // a broken or missing check can never approve
  if (signals.failures > 0) return REVIEW;
  if (imageScore === null) return REVIEW;
  if (signals.ocr && !signals.ocr.ok) return REVIEW;

  if (imageScore >= cfg.imageReview) return REVIEW;
  if (textScore !== null && textScore >= cfg.textReview) return REVIEW;

  return APPROVED;
}
