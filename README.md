### Dependencies 
- Install Docker
- Install SonarScanner
- Install Pmd
- Install Node

### Description
## PMD Steps
- Copy pmd-ruleset.xml into project root dir
- Run pmd check script 

## Sonar Steps
- Run sonar server with docker script
- Access localhost:9000
- Configure Projects and Quality Profile
- Run sonar scanner map script
- Run express server script
- Run curl into express server with USER_TOKEN and PROJECT_TOKEN 

### Commands
## Up Sonar Server & Postgre Services
```bash
cd docker
docker compose up -d
```

## Up Express Server
```bash
cd src
node server.js
```

## Map Project In Sonar (project dir)
```bash
sonar-scanner \
  -Dsonar.host.url="http://localhost:9000" \
  -Dsonar.projectKey="PROJECT_KEY" \
  -Dsonar.token="PROJECT_TOKEN" \
  -Dsonar.sources="src" \
  -Dsonar.java.binaries="target/classes"
```

## Scan Pmd With Ruleset (project dir)
```bash
pmd check -d ./src/main/java \
  -R pmd-ruleset.xml \
  -f json \
  -r project_pmd_issues.json
```

### BigQuery & Looker Studio
Normalized reports (`reports/normalized/`) are loaded into two BigQuery tables in a
`static_analysis` dataset, exposed to Looker Studio through two views.

| Object | Grain | Source |
| :-- | :-- | :-- |
| `issues` (table) | one row per violation | `*_issues_normalized.ndjson` (PMD + Sonar) |
| `file_measures` (table) | one row per file per tool | `*_measures_normalized.ndjson` |
| `v_issues` (view) | same as `issues`, plus `scope` (MAIN/TEST/PROJECT), `severity_rank`, `file_base_name` | `bigquery/views/v_issues.sql` |
| `v_file_complexity` (view) | one row per file per tool; PMD-absent files default to complexity 0 | `bigquery/views/v_file_complexity.sql` |
| `v_issue_density` (view) | one row per (project, sast_tool, file_name); issue count paired with Sonar's loc/ncloc, reused as the density denominator for both tools since PMD has no loc/ncloc of its own | `bigquery/views/v_issue_density.sql` |

## Setup
Copy `.env.example` to `.env` and set `BIGQUERY_PROJECT_ID` to your Google Cloud
**project ID** (not the display name — find it in Console > IAM & Admin > Settings, or
run `gcloud config get-value project`). `.env` is gitignored; never commit it.
```bash
cp .env.example .env
npm install
```

## Build load files (repo root)
Concatenates and validates the 36 normalized files into 2 upload-ready files
(`reports/bigquery/issues.ndjson`, `reports/bigquery/file_measures.ndjson`):
```bash
node bigquery/build-load-files.js
```

Renders the view templates under `bigquery/views/` with your project ID from `.env`
into `reports/bigquery/views/` (edit the templates, not the rendered copies):
```bash
node bigquery/render-views.js
```

## First load (BigQuery console)
- Explorer > project menu > Create dataset `static_analysis` (location cannot change later)
- Add your own data > Local file > pick `issues.ndjson`, format JSONL, destination
  `static_analysis.issues`, schema "Edit as text" pasting `bigquery/schemas/issues.schema.json`,
  Advanced options > Write preference "Overwrite table", errors allowed 0
- Repeat for `file_measures.ndjson` with `bigquery/schemas/file_measures.schema.json`
- Open each rendered file in `reports/bigquery/views/` in a SQL query tab and run it

## Reload after new normalization (Cloud Shell or local gcloud)
```bash
bq load --source_format=NEWLINE_DELIMITED_JSON --replace \
  --schema=bigquery/schemas/issues.schema.json \
  static_analysis.issues reports/bigquery/issues.ndjson

bq load --source_format=NEWLINE_DELIMITED_JSON --replace \
  --schema=bigquery/schemas/file_measures.schema.json \
  static_analysis.file_measures reports/bigquery/file_measures.ndjson
```

## Looker Studio
Create a BigQuery data source per view (`v_issues`, `v_file_complexity`, `v_issue_density`) and keep one data source
per report page. Default every page to `scope = MAIN`: PMD only scans `src/main/java`, so
including Sonar's `TEST` files makes PMD x Sonar counts incomparable.
