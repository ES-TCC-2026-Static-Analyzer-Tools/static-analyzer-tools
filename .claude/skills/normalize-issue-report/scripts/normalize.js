#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const PMD_PRIORITY_TO_SEVERITY = {
  1: 'BLOCKER',
  2: 'CRITICAL',
  3: 'MAJOR',
  4: 'MINOR',
  5: 'INFO',
};

const PMD_RULESET_TO_QUALITY = {
  design: 'MAINTAINABILITY',
  codestyle: 'MAINTAINABILITY',
  bestpractices: 'MAINTAINABILITY',
  errorprone: 'RELIABILITY',
  multithreading: 'RELIABILITY',
  security: 'SECURITY',
};

const SONAR_TYPE_TO_QUALITY = {
  CODE_SMELL: 'MAINTAINABILITY',
  BUG: 'RELIABILITY',
  VULNERABILITY: 'SECURITY',
};

// PMD's CyclomaticComplexity rule is calibrated at report-level 1 (see rulesets/pmd-ruleset.xml)
// so it emits a violation for every method/class regardless of actual complexity. Sonar Way's
// java:S1541 only flags methods/constructors above this threshold, and has no default rule for
// class-level complexity at all — so we filter to keep issue counts comparable across tools.
const CC_METHOD_RE = /^The (?:method|constructor) '.*' has a cyclomatic complexity of (\d+)\.$/;
const CC_CLASS_RE = /^The (?:class|enum|interface|annotation|record) '.*' has a total cyclomatic complexity of (\d+) \(highest (\d+)\)\.$/;
const SONAR_METHOD_COMPLEXITY_THRESHOLD = 10;

function normalizeRulesetKey(ruleset) {
  return String(ruleset || '').toLowerCase().replace(/[^a-z]/g, '');
}

function normalizePmdFileName(filename) {
  return String(filename || '').replace(/^\.\//, '');
}

function detectTool(rawReportPath) {
  const parentDir = path.basename(path.dirname(path.resolve(rawReportPath)));
  if (parentDir === 'pmd' || parentDir === 'sonar') return parentDir;
  throw new Error(
    `Could not detect sast-tool from parent directory "${parentDir}". ` +
      'Place the raw report under reports/raw/pmd/ or reports/raw/sonar/.'
  );
}

function detectProject(rawReportFileName) {
  const match = rawReportFileName.match(/^(.+)_(pmd|sonar)_issues\.json$/);
  if (!match) {
    throw new Error(
      `Raw report file name "${rawReportFileName}" does not match the expected ` +
        'pattern "<project>_<tool>_issues.json".'
    );
  }
  return match[1];
}

function normalizePmd(raw, meta) {
  const records = [];
  const fileComplexity = new Map();
  const stats = { trivialMethod: 0, classLevel: 0, unparsedCc: 0 };

  for (const file of raw.files || []) {
    const fileName = normalizePmdFileName(file.filename);
    for (const violation of file.violations || []) {
      if (violation.rule === 'CyclomaticComplexity') {
        const methodMatch = violation.description.match(CC_METHOD_RE);
        const classMatch = !methodMatch && violation.description.match(CC_CLASS_RE);

        if (methodMatch) {
          const value = Number(methodMatch[1]);
          if (value <= SONAR_METHOD_COMPLEXITY_THRESHOLD) {
            stats.trivialMethod++;
            continue;
          }
          // falls through to be recorded as an issue below
        } else if (classMatch) {
          const total = Number(classMatch[1]);
          fileComplexity.set(fileName, (fileComplexity.get(fileName) || 0) + total);
          stats.classLevel++;
          continue;
        } else {
          stats.unparsedCc++;
          console.warn(`WARNING: unrecognized CyclomaticComplexity description: "${violation.description}"`);
          // falls through to be recorded as an issue, same as pre-filtering behavior
        }
      }

      const rulesetKey = normalizeRulesetKey(violation.ruleset);
      records.push({
        raw_report: meta.rawReport,
        sast_tool: meta.tool,
        project: meta.project,
        normalized_at: meta.normalizedAt,
        rule: violation.rule,
        description: violation.description,
        file_name: fileName,
        line_number: violation.beginline ?? null,
        severity: PMD_PRIORITY_TO_SEVERITY[violation.priority] || null,
        quality: PMD_RULESET_TO_QUALITY[rulesetKey] || null,
      });
    }
  }

  const measures = [...fileComplexity.entries()].map(([fileName, complexity]) => ({
    raw_report: meta.rawReport,
    sast_tool: meta.tool,
    project: meta.project,
    normalized_at: meta.normalizedAt,
    file_name: fileName,
    loc: null,
    ncloc: null,
    complexity,
    cognitive_complexity: null,
    sqale_index: null,
    issues_maintainability: null,
    issues_reliability: null,
    issues_security: null,
  }));

  return { records, measures, stats };
}

function normalizeSonar(raw, meta) {
  const records = [];
  for (const issue of raw.issues || []) {
    const colonIndex = String(issue.component || '').indexOf(':');
    const fileName = colonIndex === -1 ? null : issue.component.slice(colonIndex + 1);
    const impactQuality = issue.impacts && issue.impacts[0] && issue.impacts[0].softwareQuality;

    records.push({
      raw_report: meta.rawReport,
      sast_tool: meta.tool,
      project: meta.project,
      normalized_at: meta.normalizedAt,
      rule: issue.rule,
      description: issue.message,
      file_name: fileName,
      line_number: typeof issue.line === 'number' ? issue.line : null,
      severity: issue.severity || null,
      quality: impactQuality || SONAR_TYPE_TO_QUALITY[issue.type] || null,
    });
  }
  return records;
}

function main() {
  const rawReportPath = process.argv[2];
  if (!rawReportPath) {
    console.error('Usage: node normalize.js <path-to-raw-report.json>');
    process.exit(1);
  }

  const resolvedPath = path.resolve(rawReportPath);
  const rawReportFileName = path.basename(resolvedPath);
  const tool = detectTool(resolvedPath);
  const project = detectProject(rawReportFileName);
  const raw = JSON.parse(fs.readFileSync(resolvedPath, 'utf8'));

  const meta = {
    rawReport: rawReportFileName,
    tool,
    project,
    normalizedAt: new Date().toISOString(),
  };

  const outDir = path.resolve(__dirname, '..', '..', '..', '..', 'reports', 'normalized', tool);
  fs.mkdirSync(outDir, { recursive: true });
  const outName = rawReportFileName.replace(/\.json$/, '_normalized.ndjson');
  const outPath = path.join(outDir, outName);

  const writeNdjson = (filePath, items) => {
    const ndjson = items.map((item) => JSON.stringify(item)).join('\n') + (items.length ? '\n' : '');
    fs.writeFileSync(filePath, ndjson, 'utf8');
  };

  if (tool === 'pmd') {
    const { records, measures, stats } = normalizePmd(raw, meta);
    writeNdjson(outPath, records);

    const inputCount = (raw.files || []).reduce((sum, f) => sum + (f.violations || []).length, 0);
    console.log(`Read ${inputCount} violations from ${rawReportFileName}`);
    console.log(
      `Filtered out CyclomaticComplexity noise: ${stats.trivialMethod} trivial methods/constructors (<=${SONAR_METHOD_COMPLEXITY_THRESHOLD}), ` +
        `${stats.classLevel} class-level entries (no Sonar equivalent)` +
        (stats.unparsedCc ? `, ${stats.unparsedCc} unparsed (kept, see warnings above)` : '')
    );
    console.log(`Wrote ${records.length} issue records to ${path.relative(process.cwd(), outPath)}`);

    const measuresOutPath = path.join(outDir, rawReportFileName.replace(/\.json$/, '_measures_normalized.ndjson'));
    writeNdjson(measuresOutPath, measures);
    console.log(`Wrote ${measures.length} derived complexity-measure records to ${path.relative(process.cwd(), measuresOutPath)}`);
  } else {
    const records = normalizeSonar(raw, meta);
    writeNdjson(outPath, records);

    const inputCount = (raw.issues || []).length;
    console.log(`Read ${inputCount} issues from ${rawReportFileName}`);
    console.log(`Wrote ${records.length} records to ${path.relative(process.cwd(), outPath)}`);
    if (inputCount !== records.length) {
      console.warn('WARNING: input/output count mismatch — check the raw report structure.');
    }
  }
}

main();
