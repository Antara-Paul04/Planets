// Google Cloud Vision OCR (DOCUMENT_TEXT_DETECTION handles handwriting).
// Used when GOOGLE_CLOUD_VISION_API_KEY is configured; otherwise the
// OpenAI vision OCR provider covers this role.

async function timedFetch(url, options, timeoutMs) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

export function googleOcrProvider(cfg) {
  return {
    name: 'google-vision-ocr',
    async extractText(imageDataURL) {
      const base64 = imageDataURL.replace(/^data:image\/(png|jpeg);base64,/, '');
      const res = await timedFetch(
        `https://vision.googleapis.com/v1/images:annotate?key=${cfg.googleVisionKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            requests: [{
              image: { content: base64 },
              features: [{ type: 'DOCUMENT_TEXT_DETECTION' }],
            }],
          }),
        },
        cfg.providerTimeoutMs
      );
      if (!res.ok) throw new Error(`ocr_http_${res.status}`);
      const json = await res.json();
      const r = json.responses && json.responses[0];
      if (!r) throw new Error('ocr_malformed');
      if (r.error) throw new Error('ocr_provider_error');
      const annotation = r.fullTextAnnotation;
      const text = annotation && typeof annotation.text === 'string' ? annotation.text : '';
      // average word confidence when present
      let conf = 0.8;
      const pages = annotation && annotation.pages;
      if (pages && pages.length && typeof pages[0].confidence === 'number') {
        conf = pages[0].confidence;
      }
      return {
        ok: true,
        text: text.slice(0, 4000),
        confidence: conf,
        provider: 'google-vision-ocr',
      };
    },
  };
}
