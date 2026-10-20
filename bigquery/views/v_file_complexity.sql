-- Template: the __PROJECT_ID__ placeholder below is substituted with the
-- BIGQUERY_PROJECT_ID value from .env by `node bigquery/render-views.js`.
-- Edit this file, not the rendered copy under reports/bigquery/views/.
-- One row per file per tool. PMD omits files whose complexity is 0 (report level 1) and
-- never analyzes src/test, so PMD rows are generated only for MAIN files, defaulting to 0.
CREATE OR REPLACE VIEW `__PROJECT_ID__.static_analysis.v_file_complexity` AS
WITH sonar AS (
  SELECT
    project,
    file_name,
    complexity,
    IF(REGEXP_CONTAINS(file_name, r'(^|/)src/test/'), 'TEST', 'MAIN') AS scope
  FROM `__PROJECT_ID__.static_analysis.file_measures`
  WHERE sast_tool = 'sonar'
),
pmd AS (
  SELECT project, file_name, complexity
  FROM `__PROJECT_ID__.static_analysis.file_measures`
  WHERE sast_tool = 'pmd'
),
combined AS (
  SELECT project, 'sonar' AS sast_tool, file_name, scope, complexity FROM sonar
  UNION ALL
  SELECT s.project, 'pmd', s.file_name, s.scope, COALESCE(p.complexity, 0)
  FROM sonar s
  LEFT JOIN pmd p USING (project, file_name)
  WHERE s.scope = 'MAIN'
)
SELECT
  project,
  sast_tool,
  file_name,
  ARRAY_REVERSE(SPLIT(file_name, '/'))[SAFE_OFFSET(0)] AS file_base_name,
  scope,
  complexity
FROM combined;
