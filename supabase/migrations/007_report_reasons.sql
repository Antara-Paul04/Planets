-- Reports carry a reason, and the owner hears about each one.
--
-- The three-different-networks rule (001) is unchanged. On top of it:
--   * a reporter can say why (<= 200 chars), stored on the report row and
--     written right after report_planet() records it (api/report.js);
--   * every report notifies the project owner (lib/reports/notify.js) with
--     signed one-click links to hide or restore the planet (api/moderate.js).
-- Still nothing personal: the reporter stays a hashed network.

alter table planet_reports add column if not exists reason text
  check (reason is null or char_length(reason) between 1 and 200);
