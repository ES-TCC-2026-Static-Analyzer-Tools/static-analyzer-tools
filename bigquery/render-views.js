#!/usr/bin/env node
'use strict';

require('dotenv').config();

const fs = require('fs');
const path = require('path');

const projectId = process.env.BIGQUERY_PROJECT_ID;
if (!projectId) {
  console.error('Missing BIGQUERY_PROJECT_ID. Copy .env.example to .env and fill in your project ID.');
  process.exit(1);
}

const templatesDir = path.join(__dirname, 'views');
const outDir = path.resolve(__dirname, '..', 'reports', 'bigquery', 'views');
fs.mkdirSync(outDir, { recursive: true });

for (const name of fs.readdirSync(templatesDir).filter((f) => f.endsWith('.sql'))) {
  const template = fs.readFileSync(path.join(templatesDir, name), 'utf8');
  const rendered = template.replaceAll('__PROJECT_ID__', projectId);
  const outPath = path.join(outDir, name);
  fs.writeFileSync(outPath, rendered, 'utf8');
  console.log(`Rendered ${path.relative(process.cwd(), outPath)}`);
}
