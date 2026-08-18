// OpenAI-backed providers: image moderation + text moderation via the
// omni moderation model, and a vision-based OCR fallback that reads
// handwriting/cursive/rotated/tiny text better than classic OCR on doodles.
// All responses are normalized into our own result shapes -- provider
// formats never leak past this module.

async function timedFetch(url, options, timeoutMs) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

function maxCategoryScore(scores) {
  let max = 0;
  const categories = {};
  for (const [k, v] of Object.entries(scores || {})) {
    if (typeof v === 'number') {
      categories[k] = v;
      if (v > max) max = v;
    }
  }
  return { max, categories };
}

export function openaiImageModerator(cfg) {
  return {
    name: 'openai-omni-moderation',
    async moderate(imageDataURL) {
      const res = await timedFetch('https://api.openai.com/v1/moderations', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${cfg.openaiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'omni-moderation-latest',
          input: [{ type: 'image_url', image_url: { url: imageDataURL } }],
        }),
      }, cfg.providerTimeoutMs);
      if (!res.ok) throw new Error(`image_moderation_http_${res.status}`);
      const json = await res.json();
      const result = json.results && json.results[0];
      if (!result) throw new Error('image_moderation_malformed');
      const { max, categories } = maxCategoryScore(result.category_scores);
      return { ok: true, score: max, categories, provider: 'openai-omni-moderation' };
    },
  };
}

export function openaiTextModerator(cfg) {
  return {
    name: 'openai-omni-moderation',
    async moderate(text) {
      if (!text || !text.trim()) {
        return { ok: true, score: 0, categories: {}, provider: 'openai-omni-moderation' };
      }
      const res = await timedFetch('https://api.openai.com/v1/moderations', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${cfg.openaiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'omni-moderation-latest',
          input: text.slice(0, 4000),
        }),
      }, cfg.providerTimeoutMs);
      if (!res.ok) throw new Error(`text_moderation_http_${res.status}`);
      const json = await res.json();
      const result = json.results && json.results[0];
      if (!result) throw new Error('text_moderation_malformed');
      const { max, categories } = maxCategoryScore(result.category_scores);
      return { ok: true, score: max, categories, provider: 'openai-omni-moderation' };
    },
  };
}

const OCR_PROMPT =
  'Transcribe ALL text visible in this image, including handwriting, cursive, ' +
  'tiny text, rotated text, stylized or partially hidden text. If there is no ' +
  'text, use an empty string. Respond with ONLY a JSON object: ' +
  '{"text": "...", "confidence": 0.0}';

export function openaiOcrProvider(cfg) {
  return {
    name: 'openai-vision-ocr',
    async extractText(imageDataURL) {
      const res = await timedFetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${cfg.openaiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          max_tokens: 300,
          response_format: { type: 'json_object' },
          messages: [{
            role: 'user',
            content: [
              { type: 'text', text: OCR_PROMPT },
              { type: 'image_url', image_url: { url: imageDataURL, detail: 'high' } },
            ],
          }],
        }),
      }, cfg.providerTimeoutMs);
      if (!res.ok) throw new Error(`ocr_http_${res.status}`);
      const json = await res.json();
      const raw = json.choices && json.choices[0] && json.choices[0].message
        ? json.choices[0].message.content : null;
      if (!raw) throw new Error('ocr_malformed');
      let parsed;
      try {
        parsed = JSON.parse(raw);
      } catch {
        throw new Error('ocr_unparseable');
      }
      return {
        ok: true,
        text: typeof parsed.text === 'string' ? parsed.text.slice(0, 4000) : '',
        confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.5,
        provider: 'openai-vision-ocr',
      };
    },
  };
}
