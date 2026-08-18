// The single configuration layer for moderation. Every threshold and limit
// lives here, sourced from environment variables with sane defaults --
// nothing is hard-coded at call sites.

const num = (name, fallback) => {
  const v = parseFloat(process.env[name]);
  return Number.isFinite(v) ? v : fallback;
};

export function getConfig() {
  if (process.env.MODERATION_MOCK === '1' && process.env.VERCEL_ENV === 'production') {
    console.error(JSON.stringify({ at: 'moderation', error: 'MODERATION_MOCK ignored in production' }));
  }
  return {
    // decision thresholds (0..1 category scores from the moderation model)
    imageReject: num('MOD_IMAGE_REJECT', 0.7),
    imageReview: num('MOD_IMAGE_REVIEW', 0.4),
    textReject: num('MOD_TEXT_REJECT', 0.8),
    textReview: num('MOD_TEXT_REVIEW', 0.5),
    // OCR text below this confidence is still moderated, but a weak OCR
    // signal alone never rejects -- it can only push toward review
    ocrLowConfidence: num('MOD_OCR_LOW_CONFIDENCE', 0.35),

    // payload limits
    maxImageBytes: num('MOD_MAX_IMAGE_BYTES', 2 * 1024 * 1024),
    maxNameLength: num('MOD_MAX_NAME_LENGTH', 64),

    // rate limits (per IP, in-memory per serverless instance)
    ratePerMinute: num('MOD_RATE_PER_MINUTE', 5),
    ratePerHour: num('MOD_RATE_PER_HOUR', 30),

    // result cache
    cacheSize: num('MOD_CACHE_SIZE', 500),
    cacheTtlMs: num('MOD_CACHE_TTL_MS', 24 * 60 * 60 * 1000),

    providerTimeoutMs: num('MOD_PROVIDER_TIMEOUT_MS', 12000),

    // mock providers are for tests/local dev ONLY -- never in production
    mock: process.env.MODERATION_MOCK === '1' && process.env.VERCEL_ENV !== 'production',
    openaiKey: process.env.OPENAI_API_KEY || null,
    googleVisionKey: process.env.GOOGLE_CLOUD_VISION_API_KEY || null,
    supabaseUrl: process.env.SUPABASE_URL || null,
    supabaseServiceKey: process.env.SUPABASE_SERVICE_ROLE_KEY || null,
  };
}
