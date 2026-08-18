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
//   image:    { ok, score, categories } | null,
//   textName: { ok, score, categories } | null,  // the planet's name
//   textOcr:  { ok, score, categories } | null,  // text extracted from artwork
//   ocr:      { ok, text, confidence } | null,
//   failures: number,                            // provider errors/timeouts
// }
export function decide(signals, cfg) {
  const imageScore = signals.image && signals.image.ok ? signals.image.score : null;
  const nameScore = signals.textName && signals.textName.ok ? signals.textName.score : null;
  const ocrTextScore = signals.textOcr && signals.textOcr.ok ? signals.textOcr.score : null;
  const ocrConfidence = signals.ocr && signals.ocr.ok ? signals.ocr.confidence : 0;

  // high-confidence unsafe wins regardless of anything else
  if (imageScore !== null && imageScore >= cfg.imageReject) return REJECTED;
  if (nameScore !== null && nameScore >= cfg.textReject) return REJECTED;
  if (ocrTextScore !== null && ocrTextScore >= cfg.textReject) {
    // OCR is one signal: a low-confidence transcription never hard-rejects
    return ocrConfidence >= cfg.ocrLowConfidence ? REJECTED : REVIEW;
  }

  // a broken or missing check can never approve
  if (signals.failures > 0) return REVIEW;
  if (imageScore === null) return REVIEW;
  if (signals.ocr && !signals.ocr.ok) return REVIEW;

  if (imageScore >= cfg.imageReview) return REVIEW;
  if (nameScore !== null && nameScore >= cfg.textReview) return REVIEW;
  if (ocrTextScore !== null && ocrTextScore >= cfg.textReview) return REVIEW;

  return APPROVED;
}
