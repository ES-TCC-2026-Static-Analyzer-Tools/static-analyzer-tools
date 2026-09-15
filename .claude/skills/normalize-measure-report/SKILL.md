---
name: normalize-measure-report
description: Normalize raw Sonar measures reports (per-file metrics: complexity, cognitive complexity, lines, sqale index, issue counts by quality) into flat NDJSON records ready for BigQuery ingestion and Looker Studio dashboards. Should be used when the user requests to normalize a raw measures report.
argument-hint: [measures-raw-report]
arguments: [raw-report]
---

Normalize a raw Sonar **measures** report into flat NDJSON (newline-delimited JSON)
records — one JSON object per file, no enclosing array — so the output can be loaded
directly into BigQuery with `bq load --source_format=NEWLINE_DELIMITED_JSON` and joined
with the normalized issues table (from the `normalize-issue-report` skill) in Looker
Studio via `(project, file_name)`.

## Infra Context
- Measures reports only exist for Sonar (PMD has no equivalent report) and live in
  `reports/raw/sonar/`, named `<project>_sonar_measures.json` (e.g.
  `apollo_sonar_measures.json`). They come from the `/metrics/tree` route in
  `src/server.js` and hold one entry per Java file (`qualifier: "FIL"`), each with a
  `measures: [{metric, value}]` array of Sonar metric keys.
- Normalized output goes to `reports/normalized/sonar/`, named
  `<project>_sonar_measures_normalized.ndjson` — same directory as the normalized
  issues files, so both can be loaded with directory-level globs.
- **Do not hand-transform the JSON.** Always normalize by running the bundled script:
  ```bash
  node .claude/skills/normalize-measure-report/scripts/normalize.js <raw-report-path>
  ```
  The script infers the project from the file name; it errors out if the file isn't
  under `reports/raw/sonar/` or doesn't match the `<project>_sonar_measures.json`
  pattern.

## Workflow
1. Resolve the raw report path under `reports/raw/sonar/` from what the user gave you
   (a project name, a file name, or a full path).
2. Run the normalize script on that path.
3. Read the script's stdout: it prints how many file components were read from the raw
   report and how many records were written. Treat any count mismatch warning as a bug
   to investigate — never silently accept a mismatch.
4. Report the output `.ndjson` path to the user.

## Field Mapping

Every record is flat (no nested objects) and uses snake_case keys so it loads into
BigQuery without renaming.

Metadata (identical convention to `normalize-issue-report`):
- `raw_report`: exact file name of the raw report (e.g. `apollo_sonar_measures.json`).
- `sast_tool`: always `"sonar"` — measures reports don't exist for PMD.
- `project`: the `<project>` segment of the raw report file name (e.g. `apollo`) —
  matches the `project` field used by `normalize-issue-report`, so both tables can be
  joined per project.
- `normalized_at`: ISO 8601 UTC timestamp of when normalization ran.
- `file_name`: the component's `path` field, used as-is (Sonar already returns the
  repo-relative path directly, unlike the issues report where it has to be parsed out
  of `component`).

Metrics, read from the component's `measures` array by Sonar metric key. When a metric
is absent from a component, the script defaults it to `0` — Sonar omits count-type
metrics when their value is zero, so absence means "zero occurrences", not "not
collected":

| Output Field              | Sonar Metric                              | Meaning                                    |
| :------------------------ | :----------------------------------------- | :------------------------------------------ |
| `loc`                     | `lines`                                    | Total lines in the file                    |
| `ncloc`                   | `ncloc`                                    | Non-comment lines of code                  |
| `complexity`              | `complexity`                               | Cyclomatic complexity                      |
| `cognitive_complexity`    | `cognitive_complexity`                     | Cognitive complexity                       |
| `sqale_index`             | `sqale_index`                              | SQALE technical debt index (minutes)       |
| `issues_maintainability`  | `software_quality_maintainability_issues`  | Issue count — Maintainability quality      |
| `issues_reliability`      | `software_quality_reliability_issues`      | Issue count — Reliability quality          |
| `issues_security`         | `software_quality_security_issues`         | Issue count — Security quality             |

The three `issues_*` fields use the same Software Quality taxonomy
(`MAINTAINABILITY`/`RELIABILITY`/`SECURITY`) as the `quality` field in
`normalize-issue-report`, so issue counts here are directly comparable to the issue-level
`quality` breakdown in the other table.

**Out of scope:** comment line count (`comment_lines`) is intentionally not normalized.
It isn't part of the `metricKeys` requested by `src/server.js`'s `/metrics/tree` route,
so it never appears in the current raw reports — there's no data to normalize. If it's
ever needed, add `comment_lines` to that route's `metricKeys` and re-run the Sonar
extraction before touching this skill again.

**PMD has no measures report of its own** (no equivalent to `/metrics/tree`), so it
can't be normalized by this skill. Instead, the `normalize-issue-report` skill derives a
`complexity`-only measures file per PMD project — `reports/normalized/pmd/
<project>_pmd_issues_measures_normalized.ndjson` — by summing the per-class cyclomatic
complexity values already present in the PMD raw *issues* report (PMD's
`CyclomaticComplexity` rule reports a file's total complexity as a side effect of being
calibrated to report level `1`; see that skill for details). Those rows use this same
field shape so they can be loaded into the same `file_measures` BigQuery table, but only
`complexity` is populated — `loc`, `ncloc`, `cognitive_complexity`, `sqale_index`, and the
three `issues_*` fields are `null` for PMD-sourced rows, since PMD doesn't compute them.

## Output Format Example

Each line of the `.ndjson` file is one complete, valid JSON object:

```json
{"raw_report":"apollo_sonar_measures.json","sast_tool":"sonar","project":"apollo","normalized_at":"2026-09-13T23:21:54.700Z","file_name":"src/main/java/com/onixx/apolloveiculos/api/ApiApplication.java","loc":15,"ncloc":11,"complexity":1,"cognitive_complexity":0,"sqale_index":24,"issues_maintainability":6,"issues_reliability":0,"issues_security":0}
```

## Loading into BigQuery

Load into a separate table from the issues data (different schema — one row per file,
not per issue):

```bash
bq load --source_format=NEWLINE_DELIMITED_JSON \
  dataset.file_measures \
  reports/normalized/sonar/*_measures_normalized.ndjson
```
