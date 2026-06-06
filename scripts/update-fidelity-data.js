#!/usr/bin/env node
const fs = require('fs');
const os = require('os');
const path = require('path');
const https = require('https');

const ROOT = path.resolve(__dirname, '..');
const DATA_FILE = path.join(ROOT, 'fidelity_data.json');
const BACKUP_DIR = path.join(ROOT, 'backups', 'fidelity-data');
const TMP_DIR = path.join(os.tmpdir(), `triton-fidelity-update-${Date.now()}`);

const FUND_SOURCES = {
  ucg: {
    slug: 'ucg',
    name: 'Fidelity Canadian Growth Company Class',
    nameEN: 'Cdn Growth Co.',
    role: '加股成长',
    color: '#EA580C'
  },
  ucl: {
    slug: 'ugg',
    name: 'Fidelity Insights Class',
    nameEN: 'Insights Class',
    role: '全球精选',
    color: '#3B82F6'
  },
  ugq: {
    slug: 'ugq',
    name: 'Fidelity Global Growth and Value Class',
    nameEN: 'Global G&V',
    role: '价值+成长',
    color: '#C9A84C'
  },
  ugb: {
    slug: 'ugbp',
    name: 'Fidelity Global Balanced Class Portfolio',
    nameEN: 'Global Balanced',
    role: '稳定器',
    color: '#10B981'
  },
  ufs: {
    slug: 'uga',
    name: 'Fidelity U.S. Focused Stock Class',
    nameEN: 'U.S. Focused',
    role: '美股精选',
    color: '#8B5CF6'
  },
  ugi: {
    slug: 'uet',
    name: 'Fidelity Global Innovators® Class',
    nameEN: 'Global Innov.',
    role: '创新主题',
    color: '#EF4444'
  }
};

const MONTHS = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  oct: 10,
  nov: 11,
  dec: 12
};

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, { headers: { 'user-agent': 'Triton fidelity updater/1.0' } }, response => {
      if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
        response.resume();
        download(response.headers.location, dest).then(resolve, reject);
        return;
      }
      if (response.statusCode !== 200) {
        response.resume();
        reject(new Error(`HTTP ${response.statusCode} for ${url}`));
        return;
      }
      const out = fs.createWriteStream(dest);
      response.pipe(out);
      out.on('finish', () => out.close(resolve));
      out.on('error', reject);
    });
    request.on('error', reject);
    request.setTimeout(30000, () => {
      request.destroy(new Error(`Timeout downloading ${url}`));
    });
  });
}

function htmlToLines(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '\n')
    .replace(/<style[\s\S]*?<\/style>/gi, '\n')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/<[^>]+>/g, '\n')
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean);
}

function parseAsOf(label) {
  const match = String(label || '').match(/^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/);
  if (!match) throw new Error(`Invalid as-of label: ${label}`);
  const day = Number(match[1]);
  const month = MONTHS[match[2].toLowerCase()];
  const year = Number(match[3]);
  if (!month) throw new Error(`Unknown month in as-of label: ${label}`);
  return {
    iso: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T16:00:00-04:00`,
    label: `${year}年${month}月${day}日`,
    sourceLabel: label,
    sortKey: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
  };
}

function numeric(line) {
  const match = String(line || '').match(/^-?\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : null;
}

function parseFundPage(html) {
  const lines = htmlToLines(html);
  const standardIndex = lines.findIndex(line => line === 'Standard period returns');
  if (standardIndex === -1) throw new Error('Missing Standard period returns table');
  const dateLine = lines[standardIndex + 1] || '';
  const asOfMatch = dateLine.match(/\(.*?\)\s+(\d{1,2}-[A-Za-z]{3}-\d{4})/);
  const asOf = parseAsOf(asOfMatch?.[1]);

  const fundIndex = lines.findIndex((line, index) => index > standardIndex && line === 'Fund');
  if (fundIndex === -1) throw new Error('Missing Fund row in Standard period returns table');
  const values = [];
  for (let i = fundIndex + 1; i < lines.length && values.length < 8; i += 1) {
    const value = numeric(lines[i]);
    if (value === null) break;
    values.push(value);
  }
  if (values.length < 6) throw new Error(`Only found ${values.length} standard return values`);

  const merIndex = lines.findIndex(line => line === 'MER');
  let mer = null;
  let merAsOf = null;
  if (merIndex !== -1) {
    for (let i = merIndex + 1; i < Math.min(lines.length, merIndex + 12); i += 1) {
      if (mer === null && /%$/.test(lines[i])) mer = numeric(lines[i]);
      if (!merAsOf && /^\d{2}-[A-Za-z]{3}-\d{4}$/.test(lines[i])) merAsOf = lines[i];
    }
  }

  return {
    asOf,
    y1: values[3],
    y3: values[4],
    y5: values[5],
    mer,
    merAsOf
  };
}

function round(value, decimals = 2) {
  if (value === null || value === undefined || Number.isNaN(value)) return null;
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function backupExistingData() {
  if (!fs.existsSync(DATA_FILE)) return null;
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dest = path.join(BACKUP_DIR, `fidelity_data.${stamp}.json`);
  fs.copyFileSync(DATA_FILE, dest);
  return dest;
}

async function fetchFund(key, config) {
  const url = `https://www.fidelity.ca/en/products/funds/${config.slug}/`;
  const htmlPath = path.join(TMP_DIR, `${config.slug}.html`);
  await download(url, htmlPath);
  const parsed = parseFundPage(fs.readFileSync(htmlPath, 'utf8'));
  return {
    key,
    ...config,
    url,
    mer: round(parsed.mer, 2),
    y1: round(parsed.y1, 2),
    y3: round(parsed.y3, 2),
    y5: round(parsed.y5, 2),
    asOf: parsed.asOf,
    merAsOf: parsed.merAsOf
  };
}

async function main() {
  fs.mkdirSync(TMP_DIR, { recursive: true });
  const funds = {};
  const fetched = [];

  for (const [key, config] of Object.entries(FUND_SOURCES)) {
    const fund = await fetchFund(key, config);
    funds[key] = {
      name: fund.name,
      nameEN: fund.nameEN,
      mer: fund.mer,
      role: fund.role,
      color: fund.color,
      y1: fund.y1,
      y3: fund.y3,
      y5: fund.y5,
      source: {
        primary: 'Fidelity Investments Canada',
        url: fund.url,
        asOf: fund.asOf.sourceLabel,
        merAsOf: fund.merAsOf
      }
    };
    fetched.push(fund);
    console.log(`${fund.name}: 1Y=${fund.y1} 3Y=${fund.y3} 5Y=${fund.y5} MER=${fund.mer ?? 'n/a'} asOf=${fund.asOf.sourceLabel}`);
  }

  const dates = fetched.map(fund => fund.asOf.sortKey).sort();
  const newestDate = dates[dates.length - 1];
  const newest = fetched.find(fund => fund.asOf.sortKey === newestDate);
  const payload = {
    lastUpdated: newest.asOf.iso,
    asOfLabel: newest.asOf.label,
    dataSource: {
      primary: 'Fidelity Investments Canada fund pages',
      url: 'https://www.fidelity.ca',
      lastAutomatedUpdate: new Date().toISOString(),
      updateMode: 'NAS monthly cron; official Fidelity pages parsed from Standard period returns',
      note: 'Fund returns are historical standard period returns from Fidelity Canada fund pages. T5/T8 distribution rates are product distribution targets and are not investment return forecasts.'
    },
    funds
  };

  const backup = backupExistingData();
  fs.writeFileSync(DATA_FILE, `${JSON.stringify(payload, null, 2)}\n`);
  fs.rmSync(TMP_DIR, { recursive: true, force: true });
  console.log(`Updated ${DATA_FILE}`);
  if (backup) console.log(`Backup saved to ${backup}`);
}

main().catch(error => {
  try {
    fs.rmSync(TMP_DIR, { recursive: true, force: true });
  } catch {}
  console.error(error.stack || error.message);
  process.exit(1);
});
