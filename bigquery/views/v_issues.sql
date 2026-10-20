-- Template: the __PROJECT_ID__ placeholder below is substituted with the
-- BIGQUERY_PROJECT_ID value from .env by `node bigquery/render-views.js`.
-- Edit this file, not the rendered copy under reports/bigquery/views/.
CREATE OR REPLACE VIEW `__PROJECT_ID__.static_analysis.v_issues` AS
SELECT
  project,
  sast_tool,
  rule,
  description,
  quality,
  severity,
  CASE severity
    WHEN 'BLOCKER' THEN 1
    WHEN 'CRITICAL' THEN 2
    WHEN 'MAJOR' THEN 3
    WHEN 'MINOR' THEN 4
    WHEN 'INFO' THEN 5
  END AS severity_rank,
  file_name,
  ARRAY_REVERSE(SPLIT(file_name, '/'))[SAFE_OFFSET(0)] AS file_base_name,
  line_number,
  CASE
    WHEN file_name IS NULL THEN 'PROJECT'
    WHEN REGEXP_CONTAINS(file_name, r'(^|/)src/test/') THEN 'TEST'
    ELSE 'MAIN'
  END AS scope,
  raw_report,
  normalized_at
FROM `__PROJECT_ID__.static_analysis.issues`;
