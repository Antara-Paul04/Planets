import { randomUUID } from 'node:crypto';
import { decide, REVIEW } from './decision.js';
import { getProviders } from './providers/index.js';
import { getStore } from './store.js';

// The moderation pipeline for one submission:
//
//   artwork (original rectangular canvas, already flattened by the client)
//        |-----------------------------|
//        v                             v
//   OCR / handwriting            image moderation
//        v                             |
//   extracted text + planet name       |
//        v                             |
//   text moderation                    |
//        |-----------------------------|
//        v
//   decision: approved | review | rejected
//
// Any provider failure counts as a failure signal and the decision layer
// fails closed to REVIEW. The artwork itself is never stored or logged here;
// only scores, extracted text, and timing.

export async function runModeration({ image, name, cfg }) {
  const submissionId = randomUUID();
  const started = Date.now();
  const providers = getProviders(cfg, { name });

  if (!providers) {
    // moderation not configured on this deployment: fail closed
    log(cfg, { submissionId, decision: REVIEW, error: 'not_configured', ms: 0 });
    return { submissionId, decision: REVIEW, reason: 'not_configured' };
  }

  let failures = 0;
  const [imageOut, ocrOut] = await Promise.allSettled([
    providers.image.moderate(image),
    providers.ocr.extractText(image),
  ]);

  const imageResult = imageOut.status === 'fulfilled' ? imageOut.value : null;
  if (!imageResult) failures += 1;
  const ocrResult = ocrOut.status === 'fulfilled' ? ocrOut.value : null;
  if (!ocrResult) failures += 1;

  // moderate the name and any OCR-extracted text as SEPARATE signals, so
  // the decision layer can weigh OCR confidence without punishing the name
  let textName = null;
  if (name && name.trim()) {
    try {
      textName = await providers.text.moderate(name.trim());
    } catch {
      failures += 1;
    }
  }
  let textOcr = null;
  const ocrText = ocrResult && ocrResult.text ? ocrResult.text.trim() : '';
  if (ocrText) {
    try {
      textOcr = await providers.text.moderate(ocrText);
    } catch {
      failures += 1;
    }
  }

  const decision = decide({ image: imageResult, textName, textOcr, ocr: ocrResult, failures }, cfg);
  const ms = Date.now() - started;

  const job = {
    submission_id: submissionId,
    status: decision,
    image_score: imageResult ? round3(imageResult.score) : null,
    ocr_text: ocrResult && decision !== 'approved' ? ocrResult.text.slice(0, 500) : null,
    ocr_confidence: ocrResult ? round3(ocrResult.confidence) : null,
    text_score: round3(Math.max(textName ? textName.score : 0, textOcr ? textOcr.score : 0)) || null,
    provider: [
      imageResult && imageResult.provider,
      ocrResult && ocrResult.provider,
      (textName || textOcr) && (textName || textOcr).provider,
    ].filter(Boolean).join('+') || null,
    latency_ms: ms,
    error_category: failures > 0 ? 'provider_failure' : null,
  };
  try {
    // record-keeping must never block or hang a decision
    await Promise.race([
      getStore(cfg).saveJob(job),
      new Promise((resolve) => setTimeout(resolve, 3000)),
    ]);
  } catch {
    /* ignored */
  }

  log(cfg, {
    submissionId,
    decision,
    imageScore: job.image_score,
    textScore: job.text_score,
    ocrConfidence: job.ocr_confidence,
    provider: job.provider,
    failures,
    ms,
  });

  return { submissionId, decision };
}

function round3(v) {
  return typeof v === 'number' ? Math.round(v * 1000) / 1000 : null;
}

// structured, artwork-free, key-free logging
function log(cfg, fields) {
  try {
    console.log(JSON.stringify({ at: 'moderation', ts: new Date().toISOString(), ...fields }));
  } catch {
    /* logging must never throw */
  }
}
