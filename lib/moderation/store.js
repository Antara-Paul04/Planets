// Moderation record store. The interface is small so a real database can
// slot in later; today there are two implementations:
//   - MemoryStore: per-instance, ephemeral (default -- no database configured)
//   - SupabaseStore: activates automatically when SUPABASE_URL and
//     SUPABASE_SERVICE_ROLE_KEY are present (server-side only, never sent
//     to the browser)
//
// Suggested schema when a database is added (matches what saveJob records):
//
//   create table moderation_jobs (
//     id uuid primary key default gen_random_uuid(),
//     submission_id text not null,
//     status text not null,            -- approved | review | rejected
//     image_score real,
//     ocr_text text,                   -- extracted text only, never artwork
//     ocr_confidence real,
//     text_score real,
//     provider text,
//     latency_ms integer,
//     error_category text,
//     created_at timestamptz default now(),
//     reviewed_at timestamptz
//   );
//   create table planet_reports (
//     id uuid primary key default gen_random_uuid(),
//     planet_name text,
//     solar_system_id integer,
//     recheck_status text,
//     created_at timestamptz default now()
//   );
//
// No names, emails, phone numbers, or identities anywhere -- moderation is
// about the artwork, not the person.

class MemoryStore {
  constructor() {
    this.jobs = [];
    this.reports = [];
  }
  async saveJob(job) {
    this.jobs.push(job);
    if (this.jobs.length > 1000) this.jobs.shift();
  }
  async saveReport(report) {
    this.reports.push(report);
    if (this.reports.length > 1000) this.reports.shift();
  }
}

class SupabaseStore {
  constructor(cfg) {
    this.url = cfg.supabaseUrl.replace(/\/$/, '');
    this.key = cfg.supabaseServiceKey;
  }
  async _insert(table, row) {
    const res = await fetch(`${this.url}/rest/v1/${table}`, {
      method: 'POST',
      headers: {
        apikey: this.key,
        Authorization: `Bearer ${this.key}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify(row),
    });
    if (!res.ok) throw new Error(`store_insert_${res.status}`);
  }
  async saveJob(job) {
    await this._insert('moderation_jobs', job);
  }
  async saveReport(report) {
    await this._insert('planet_reports', report);
  }
}

let store = null;
export function getStore(cfg) {
  if (!store) {
    store = cfg.supabaseUrl && cfg.supabaseServiceKey ? new SupabaseStore(cfg) : new MemoryStore();
  }
  return store;
}
