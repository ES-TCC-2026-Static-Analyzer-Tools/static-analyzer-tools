-- Template: the __PROJECT_ID__ placeholder below is substituted with the
-- BIGQUERY_PROJECT_ID value from .env by `node bigquery/render-views.js`.
-- Edit this file, not the rendered copy under reports/bigquery/views/.
--
-- One row per (project, sast_tool, file_name): issue_count for that tool in that
-- file, paired with Sonar's loc/ncloc for the SAME file. PMD has no loc/ncloc of
-- its own (reports/normalized/pmd/*_measures_normalized.ndjson only carries
-- `complexity` - see normalize-issue-report's SKILL.md), so Sonar's measurement is
-- reused as the common denominator for density on both tools. Only MAIN-scope
-- files Sonar measured are included, same reasoning as v_file_complexity: PMD
-- never analyzes src/test, so comparing densities needs the same file set.
--
-- IMPORTANT when aggregating in Looker Studio: loc/ncloc are repeated once per
-- tool row (one row for 'pmd', one for 'sonar', same file -> same loc value on
-- both). Always filter or group by sast_tool before SUM(loc)/SUM(ncloc), or the
-- total doubles. issue_count never needs this care - it's already tool-specific.
CREATE OR REPLACE VIEW `__PROJECT_ID__.static_analysis.v_issue_density` AS
WITH sonar_loc AS (
  SELECT project, file_name, loc, ncloc
  FROM `__PROJECT_ID__.static_analysis.file_measures`
  WHERE sast_tool = 'sonar'
    AND NOT REGEXP_CONTAINS(file_name, r'(^|/)src/test/')
),
issue_counts AS (
  SELECT project, sast_tool, file_name, COUNT(*) AS issue_count
  FROM `__PROJECT_ID__.static_analysis.issues`
  WHERE file_name IS NOT NULL
  GROUP BY project, sast_tool, file_name
)
SELECT
  s.project,
  tool AS sast_tool,
  s.file_name,
  ARRAY_REVERSE(SPLIT(s.file_name, '/'))[SAFE_OFFSET(0)] AS file_base_name,
  s.loc,
  s.ncloc,
  COALESCE(i.issue_count, 0) AS issue_count
FROM sonar_loc s
CROSS JOIN UNNEST(['pmd', 'sonar']) AS tool
LEFT JOIN issue_counts i
  ON i.project = s.project AND i.file_name = s.file_name AND i.sast_tool = tool;
