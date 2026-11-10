#!/usr/bin/env node
'use strict';

/**
 * norm-validation.js - Checagens de consistência da normalização.
 *
 * SOMENTE LEITURA: não altera nem recria nada em reports/.
 * Uso (na raiz do repositório, a pasta que contém "reports/"):
 *   node norm-validation.js            # raiz = diretório atual
 *   node norm-validation.js <raiz>     # raiz explícita
 * Saída: tabela no terminal + norm-result.csv no diretório atual.
 *
 * Cobre: contagem bruto -> NDJSON (com a identidade do filtro de complexidade
 * do PMD), linhas inválidas, nulos, duplicatas, chaves repetidas e limite de
 * 10.000 itens do Sonar, regra java:S1541, alertas de segurança e peso da
 * CyclomaticComplexity no PMD.
 * NÃO cobre: contagem no BigQuery e tamanho dos projetos
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(process.argv[2] || '.');
const SONAR_API_CAP = 10000;
const METHOD_THRESHOLD = 10;

// Mesmas expressões do normalize.js (skill normalize-issue-report).
const CC_METHOD_RE = /^The (?:method|constructor) '.*' has a cyclomatic complexity of (\d+)\.$/;
const CC_CLASS_RE = /^The (?:class|enum|interface|annotation|record) '.*' has a total cyclomatic complexity of (\d+) \(highest (\d+)\)\.$/;

const rawDir = (tool) => path.join(ROOT, 'reports', 'raw', tool);
const normDir = (tool) => path.join(ROOT, 'reports', 'normalized', tool);

function listReports(tool) {
  const dir = rawDir(tool);
  if (!fs.existsSync(dir)) return [];
  const re = new RegExp(`^(.+)_${tool}_issues\\.json$`);
  return fs
    .readdirSync(dir)
    .map((f) => {
      const m = f.match(re);
      return m ? { project: m[1], file: path.join(dir, f) } : null;
    })
    .filter(Boolean)
    .sort((a, b) => a.project.localeCompare(b.project));
}

function readNdjson(file) {
  if (!fs.existsSync(file)) return null;
  const lines = fs.readFileSync(file, 'utf8').split('\n').filter((l) => l.length > 0);
  const records = [];
  let invalid = 0;
  for (const line of lines) {
    try {
      records.push(JSON.parse(line));
    } catch {
      invalid++;
    }
  }
  return { lines: lines.length, records, invalid };
}

function summarize(records) {
  const s = {
    nullSeverity: 0,
    nullQuality: 0,
    nullFile: 0,
    nullLine: 0,
    security: 0,
    cc: 0,
    dupExtra: 0,
    nullQualityRules: {},
    s1541: 0,
  };
  const seen = new Map();
  for (const r of records) {
    if (r.severity == null) s.nullSeverity++;
    if (r.quality == null) {
      s.nullQuality++;
      s.nullQualityRules[r.rule] = (s.nullQualityRules[r.rule] || 0) + 1;
    }
    if (r.file_name == null) s.nullFile++;
    if (r.line_number == null) s.nullLine++;
    if (r.quality === 'SECURITY') s.security++;
    if (r.rule === 'CyclomaticComplexity') s.cc++;
    if (r.rule === 'java:S1541') s.s1541++;
    const key = [r.rule, r.file_name, r.line_number, r.description].join('\u0001');
    seen.set(key, (seen.get(key) || 0) + 1);
  }
  for (const n of seen.values()) if (n > 1) s.dupExtra += n - 1;
  return s;
}

function topRules(obj, n = 5) {
  return Object.entries(obj)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([rule, count]) => `${rule} (${count})`)
    .join(', ');
}

function checkPmd({ project, file }) {
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  let read = 0;
  let trivial = 0;
  let classLevel = 0;
  let unparsed = 0;
  for (const f of raw.files || []) {
    for (const v of f.violations || []) {
      read++;
      if (v.rule !== 'CyclomaticComplexity') continue;
      const m = v.description.match(CC_METHOD_RE);
      const c = !m && v.description.match(CC_CLASS_RE);
      if (m) {
        if (Number(m[1]) <= METHOD_THRESHOLD) trivial++;
      } else if (c) {
        classLevel++;
      } else {
        unparsed++;
      }
    }
  }
  const expected = read - trivial - classLevel;
  const nd = readNdjson(path.join(normDir('pmd'), `${project}_pmd_issues_normalized.ndjson`));
  return buildRow('pmd', project, read, trivial + classLevel, expected, nd, {
    problems: unparsed > 0 ? [`${unparsed} descrição(ões) de CyclomaticComplexity não reconhecida(s)`] : [],
    notes: `triviais=${trivial}; classe=${classLevel}`,
  });
}

function checkSonar({ project, file }) {
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  const issues = raw.issues || [];
  const uniqueKeys = new Set(issues.map((i) => i.key)).size;
  const dupKeys = issues.length - uniqueKeys;
  const total = raw.total ?? (raw.paging && raw.paging.total) ?? null;
  const problems = [];
  if (dupKeys > 0) problems.push(`${dupKeys} chave(s) repetida(s) no bruto`);
  if (issues.length >= SONAR_API_CAP) problems.push(`bruto no limite da API (${SONAR_API_CAP}): provável truncamento`);
  if (total != null && total !== issues.length) problems.push(`total do servidor (${total}) difere do bruto (${issues.length})`);
  const nd = readNdjson(path.join(normDir('sonar'), `${project}_sonar_issues_normalized.ndjson`));
  return buildRow('sonar', project, issues.length, 0, issues.length, nd, {
    problems,
    notes: `total_servidor=${total == null ? 'n/d' : total}`,
  });
}

function buildRow(tool, project, rawRead, filtered, expected, nd, extra) {
  const row = {
    tool,
    project,
    raw_read: rawRead,
    filtered_out: filtered,
    expected,
    ndjson_lines: nd ? nd.lines : null,
    diff: nd ? nd.lines - expected : null,
    invalid_lines: nd ? nd.invalid : null,
    null_severity: null,
    null_quality: null,
    null_file: null,
    null_line: null,
    security: null,
    cc_pct: null,
    dup_candidates: null,
    notes: extra.notes,
    status: 'OK',
    attention: [],
  };
  const problems = [...extra.problems];
  if (!nd) {
    row.status = 'SEM NDJSON';
    return row;
  }
  const s = summarize(nd.records);
  row.null_severity = s.nullSeverity;
  row.null_quality = s.nullQuality;
  row.null_file = s.nullFile;
  row.null_line = s.nullLine;
  row.security = s.security;
  row.cc_pct = nd.records.length ? Math.round((1000 * s.cc) / nd.records.length) / 10 : 0;
  row.dup_candidates = s.dupExtra;
  row.s1541 = s.s1541;
  if (row.diff !== 0) problems.push(`NDJSON difere do esperado em ${row.diff}`);
  if (nd.invalid > 0) problems.push(`${nd.invalid} linha(s) inválida(s) no NDJSON`);
  if (s.nullSeverity > 0) row.attention.push(`${s.nullSeverity} sem severidade`);
  if (s.nullQuality > 0) row.attention.push(`${s.nullQuality} sem qualidade (regras: ${topRules(s.nullQualityRules)})`);
  if (s.dupExtra > 0) row.attention.push(`${s.dupExtra} duplicata(s) candidata(s) (inspecionar)`);
  if (problems.length) {
    row.status = 'VERIFICAR';
    row.attention.unshift(...problems);
  }
  return row;
}

function orphanNormalized(tool, projects) {
  const dir = normDir(tool);
  if (!fs.existsSync(dir)) return [];
  const re = new RegExp(`^(.+)_${tool}_issues_normalized\\.ndjson$`);
  return fs
    .readdirSync(dir)
    .map((f) => {
      const m = f.match(re);
      return m && !projects.has(m[1]) ? f : null;
    })
    .filter(Boolean);
}

function main() {
  const pmd = listReports('pmd');
  const sonar = listReports('sonar');
  if (!pmd.length && !sonar.length) {
    console.error(`Nenhum relatório bruto encontrado em ${path.join(ROOT, 'reports', 'raw')}.`);
    console.error('Rode o script na raiz do repositório (pasta que contém "reports/") ou passe o caminho.');
    process.exit(1);
  }

  const rows = [...pmd.map(checkPmd), ...sonar.map(checkSonar)].sort(
    (a, b) => a.project.localeCompare(b.project) || a.tool.localeCompare(b.tool)
  );

  console.log(`\nRaiz: ${ROOT}\n`);
  console.table(
    rows.map((r) => ({
      projeto: r.project,
      ferramenta: r.tool,
      bruto: r.raw_read,
      filtrado: r.filtered_out,
      esperado: r.expected,
      ndjson: r.ndjson_lines,
      dif: r.diff,
      'nulo sev': r.null_severity,
      'nulo qual': r.null_quality,
      'nulo arq': r.null_file,
      'nulo lin': r.null_line,
      seguranca: r.security,
      'CC %': r.cc_pct,
      status: r.status,
    }))
  );

  const attention = rows.filter((r) => r.attention.length);
  if (attention.length) {
    console.log('\nPontos de atenção:');
    for (const r of attention) {
      console.log(`- ${r.project} / ${r.tool}:`);
      for (const a of r.attention) console.log(`    * ${a}`);
    }
  }

  for (const [tool, list] of [['pmd', pmd], ['sonar', sonar]]) {
    const orphans = orphanNormalized(tool, new Set(list.map((p) => p.project)));
    if (orphans.length) console.log(`\nNDJSON sem relatório bruto correspondente (${tool}): ${orphans.join(', ')}`);
  }

  const sum = (tool, field) => rows.filter((r) => r.tool === tool).reduce((acc, r) => acc + (r[field] || 0), 0);
  console.log('\nResumo:');
  console.log(`- Alertas de segurança normalizados: PMD=${sum('pmd', 'security')}, Sonar=${sum('sonar', 'security')}`);
  console.log(`- Ocorrências de java:S1541 no Sonar: ${sum('sonar', 's1541')}`);
  const pmdTotal = sum('pmd', 'ndjson_lines');
  const pmdCc = rows.filter((r) => r.tool === 'pmd').reduce((acc, r) => acc + Math.round(((r.cc_pct || 0) * (r.ndjson_lines || 0)) / 100), 0);
  console.log(`- CyclomaticComplexity no PMD: ~${pmdTotal ? Math.round((1000 * pmdCc) / pmdTotal) / 10 : 0}% dos alertas normalizados`);
  console.log(`- Linhas com status diferente de OK: ${rows.filter((r) => r.status !== 'OK').length} de ${rows.length}`);

  const header = [
    'project', 'tool', 'raw_read', 'filtered_out', 'expected', 'ndjson_lines', 'diff', 'invalid_lines',
    'null_severity', 'null_quality', 'null_file', 'null_line', 'security', 'cc_pct', 'dup_candidates', 's1541',
    'status', 'notes', 'attention',
  ];
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const csv = [header.join(',')]
    .concat(rows.map((r) => header.map((h) => esc(h === 'attention' ? r.attention.join(' | ') : r[h])).join(',')))
    .join('\n');
  fs.writeFileSync('norm-result.csv', csv + '\n', 'utf8');
  console.log('\nCSV gravado em norm-result.csv');
}

main();