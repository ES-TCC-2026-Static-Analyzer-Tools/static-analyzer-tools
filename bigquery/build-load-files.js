#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const NORMALIZED_DIR = path.join(ROOT, 'reports', 'normalized');
const OUT_DIR = path.join(ROOT, 'reports', 'bigquery');

const TABLES = [
  { name: 'issues', suffix: '_issues_normalized.ndjson' },
  { name: 'file_measures', suffix: '_measures_normalized.ndjson' },
];

function loadSchema(tableName) {
  return JSON.parse(fs.readFileSync(path.join(__dirname, 'schemas', `${tableName}.schema.json`), 'utf8'));
}

function checkType(value, type) {
  if (type === 'INTEGER') return Number.isInteger(value);
  if (type === 'TIMESTAMP') return typeof value === 'string' && !Number.isNaN(Date.parse(value));
  return typeof value === 'string';
}

function validateRecord(record, schema) {
  const errors = [];
  const known = new Set(schema.map((field) => field.name));
  for (const key of Object.keys(record)) {
    if (!known.has(key)) errors.push(`unexpected field "${key}"`);
  }
  for (const field of schema) {
    const value = record[field.name];
    if (value === null || value === undefined) {
      if (field.mode === 'REQUIRED') errors.push(`missing required field "${field.name}"`);
    } else if (!checkType(value, field.type)) {
      errors.push(`field "${field.name}" is not a valid ${field.type}`);
    }
  }
  return errors;
}

function listSourceFiles(suffix) {
  const files = [];
  for (const tool of ['pmd', 'sonar']) {
    const dir = path.join(NORMALIZED_DIR, tool);
    if (!fs.existsSync(dir)) continue;
    for (const name of fs.readdirSync(dir).sort()) {
      if (name.endsWith(suffix)) files.push({ tool, file: path.join(dir, name) });
    }
  }
  return files;
}

function buildTable({ name, suffix }) {
  const schema = loadSchema(name);
  const lines = [];
  const perTool = {};
  const failures = [];

  for (const { file } of listSourceFiles(suffix)) {
    const rows = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean);
    rows.forEach((row, index) => {
      let record;
      try {
        record = JSON.parse(row);
      } catch (error) {
        failures.push(`${path.basename(file)}:${index + 1}: invalid JSON`);
        return;
      }
      const errors = validateRecord(record, schema);
      if (errors.length) {
        failures.push(`${path.basename(file)}:${index + 1}: ${errors.join('; ')}`);
        return;
      }
      perTool[record.sast_tool] = (perTool[record.sast_tool] || 0) + 1;
      lines.push(JSON.stringify(record));
    });
  }

  if (failures.length) {
    console.error(`Validation failed for table "${name}" (${failures.length} problems):`);
    failures.slice(0, 20).forEach((failure) => console.error(`  ${failure}`));
    process.exit(1);
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const outPath = path.join(OUT_DIR, `${name}.ndjson`);
  fs.writeFileSync(outPath, lines.join('\n') + (lines.length ? '\n' : ''), 'utf8');

  const breakdown = Object.entries(perTool).map(([tool, count]) => `${tool} ${count}`).join(' / ');
  console.log(`${name}: ${lines.length} rows (${breakdown}) -> ${path.relative(process.cwd(), outPath)}`);
}

TABLES.forEach(buildTable);
