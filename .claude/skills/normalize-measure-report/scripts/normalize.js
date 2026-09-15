#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const NUMERIC_METRICS = [
  ['lines', 'loc'],
  ['ncloc', 'ncloc'],
  ['complexity', 'complexity'],
  ['cognitive_complexity', 'cognitive_complexity'],
  ['sqale_index', 'sqale_index'],
  ['software_quality_maintainability_issues', 'issues_maintainability'],
  ['software_quality_reliability_issues', 'issues_reliability'],
  ['software_quality_security_issues', 'issues_security'],
];

function getMetric(measures, metricKey, defaultValue) {
  const entry = (measures || []).find((m) => m.metric === metricKey);
  if (!entry) return defaultValue;
  const num = Number(entry.value);
  return Number.isFinite(num) ? num : defaultValue;
}

function detectProject(rawReportFileName) {
  const match = rawReportFileName.match(/^(.+)_sonar_measures\.json$/);
  if (!match) {
    throw new Error(
      `Raw report file name "${rawReportFileName}" does not match the expected ` +
        'pattern "<project>_sonar_measures.json".'
    );
  }
  return match[1];
}

function normalizeMeasures(raw, meta) {
  const records = [];
  for (const component of raw.components || []) {
    const record = {
      raw_report: meta.rawReport,
      sast_tool: 'sonar',
      project: meta.project,
      normalized_at: meta.normalizedAt,
      file_name: component.path,
    };
    for (const [metricKey, fieldName] of NUMERIC_METRICS) {
      record[fieldName] = getMetric(component.measures, metricKey, 0);
    }
    records.push(record);
  }
  return records;
}

function main() {
  const rawReportPath = process.argv[2];
  if (!rawReportPath) {
    console.error('Usage: node normalize.js <path-to-raw-measures-report.json>');
    process.exit(1);
  }

  const resolvedPath = path.resolve(rawReportPath);
  const rawReportFileName = path.basename(resolvedPath);
  const parentDir = path.basename(path.dirname(resolvedPath));
  if (parentDir !== 'sonar') {
    throw new Error(
      `Expected raw measures report under reports/raw/sonar/, got parent directory "${parentDir}".`
    );
  }

  const project = detectProject(rawReportFileName);
  const raw = JSON.parse(fs.readFileSync(resolvedPath, 'utf8'));

  const meta = {
    rawReport: rawReportFileName,
    project,
    normalizedAt: new Date().toISOString(),
  };

  const records = normalizeMeasures(raw, meta);

  const outDir = path.resolve(__dirname, '..', '..', '..', '..', 'reports', 'normalized', 'sonar');
  fs.mkdirSync(outDir, { recursive: true });
  const outName = rawReportFileName.replace(/\.json$/, '_normalized.ndjson');
  const outPath = path.join(outDir, outName);

  const ndjson = records.map((record) => JSON.stringify(record)).join('\n') + (records.length ? '\n' : '');
  fs.writeFileSync(outPath, ndjson, 'utf8');

  const inputCount = (raw.components || []).length;

  console.log(`Read ${inputCount} components from ${rawReportFileName}`);
  console.log(`Wrote ${records.length} records to ${path.relative(process.cwd(), outPath)}`);
  if (inputCount !== records.length) {
    console.warn('WARNING: input/output count mismatch — check the raw report structure.');
  }
}

main();
