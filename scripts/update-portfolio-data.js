#!/usr/bin/env node
const fs = require('fs');
const os = require('os');
const path = require('path');
const https = require('https');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const DATA_FILE = path.join(ROOT, 'portfolio_data.json');
const BACKUP_DIR = path.join(ROOT, 'backups', 'portfolio-data');
const TMP_DIR = path.join(os.tmpdir(), `triton-portfolio-update-${Date.now()}`);

const FUND_SOURCES = {
  'Fidelity® Tactical High Income': {
    id: '857506',
    label: 'Equitable Fidelity Tactical High Income'
  },
  'MFS Low Volatility Canadian Equity': {
    id: '577',
    label: 'Equitable MFS Low Volatility Canadian Equity'
  },
  'Fidelity® Dividend': {
    id: '857504',
    label: 'Equitable Fidelity Dividend'
  },
  'Vanguard Canada Index ETF': {
    id: '857561',
    label: 'Equitable Vanguard Canada Index ETF'
  },
  'Vanguard S&P 500 Index ETF': {
    id: '857565',
    label: 'Equitable Vanguard S&P 500 Index ETF'
  },
  'Fidelity® Global Equity+ Balanced': {
    id: '857505',
    label: 'Equitable Fidelity Global Equity+ Balanced'
  },
  'Fidelity® U.S. Focused Stock': {
    id: '730513',
    label: 'Equitable Fidelity U.S. Focused Stock'
  },
  'Brandes Global Equity': {
    id: '857471',
    label: 'Equitable Brandes Global Equity'
  },
  'Vanguard Developed All Cap ex NA ETF': {
    id: '857563',
    label: 'Equitable Vanguard Global All Cap ex Canada Index ETF'
  },
  'Fidelity® Global Innovators': {
    id: '730517',
    label: 'Equitable Fidelity Global Innovators'
  },
  'Invesco NASDAQ 100 Index ETF': {
    id: '857550',
    label: 'Equitable Invesco NASDAQ 100 Index ETF'
  },
  'Fidelity® Special Situations': {
    id: '322078',
    label: 'Equitable Fidelity Special Situations'
  },
  'Mackenzie Emerging Markets': {
    id: '730521',
    label: 'Equitable Mackenzie Emerging Markets'
  }
};

const MONTHS = {
  january: 1,
  february: 2,
  march: 3,
  april: 4,
  may: 5,
  june: 6,
  july: 7,
  august: 8,
  september: 9,
  october: 10,
  november: 11,
  december: 12
};

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, { headers: { 'user-agent': 'Triton portfolio updater/1.0' } }, response => {
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

function pdfToText(pdfPath) {
  try {
    return execFileSync('pdftotext', [pdfPath, '-'], { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 });
  } catch (error) {
    throw new Error(`pdftotext failed for ${path.basename(pdfPath)}: ${error.message}`);
  }
}

function compactLines(text) {
  return text
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean);
}

function numberAfterLabel(lines, label) {
  const index = lines.findIndex(line => line.replace(/\s+/g, ' ') === label);
  if (index === -1) return null;
  for (let i = index + 1; i < Math.min(lines.length, index + 8); i += 1) {
    const match = lines[i].match(/-?\d+(?:\.\d+)?/);
    if (match) return Number(match[0]);
  }
  return null;
}

function numberAfterLineMatching(lines, pattern) {
  const index = lines.findIndex(line => pattern.test(line));
  if (index === -1) return null;
  for (let i = index + 1; i < Math.min(lines.length, index + 8); i += 1) {
    const match = lines[i].match(/-?\d+(?:\.\d+)?/);
    if (match) return Number(match[0]);
  }
  return null;
}

function parseAsOf(lines) {
  const line = lines.find(value => /^As of [A-Za-z]+ \d{1,2}, \d{4}$/.test(value));
  if (!line) throw new Error('Missing "As of" date');
  const match = line.match(/^As of ([A-Za-z]+) (\d{1,2}), (\d{4})$/);
  const month = MONTHS[match[1].toLowerCase()];
  if (!month) throw new Error(`Unknown month in ${line}`);
  const day = Number(match[2]);
  const year = Number(match[3]);
  const yyyy = String(year);
  const mm = String(month).padStart(2, '0');
  const dd = String(day).padStart(2, '0');
  return {
    iso: `${yyyy}-${mm}-${dd}T16:00:00-04:00`,
    label: `${year}年${month}月${day}日`,
    sourceLabel: `${match[1]} ${day}, ${year}`,
    sortKey: `${yyyy}-${mm}-${dd}`
  };
}

function parseFundSummary(text) {
  const lines = compactLines(text);
  const asOf = parseAsOf(lines);
  const compoundIndex = lines.findIndex(line => line === 'Compound Return (%)');
  if (compoundIndex === -1) throw new Error('Missing Compound Return table');
  const fundIndex = lines.findIndex((line, index) => index > compoundIndex && line === 'Fund');
  if (fundIndex === -1) throw new Error('Missing Fund row in Compound Return table');

  const values = [];
  for (let i = fundIndex + 1; i < lines.length && values.length < 7; i += 1) {
    if (lines[i] === 'Quartile') break;
    if (/^[-–—]+$/.test(lines[i])) {
      values.push(null);
      continue;
    }
    const match = lines[i].match(/^-?\d+(?:\.\d+)?/);
    if (match) values.push(Number(match[0]));
  }
  if (values.length < 4) {
    throw new Error(`Compound Return table has only ${values.length} numeric values`);
  }

  const mer = numberAfterLabel(lines, 'Estimated Management Expense Ratio (MER) :')
    ?? numberAfterLabel(lines, 'Management Expense Ratio (MER):')
    ?? numberAfterLineMatching(lines, /Expense Ratio \(MER\)/);

  return {
    asOf,
    y1: values[3],
    y3: values[4],
    y5: values[5],
    ytd: numberAfterLabel(lines, 'YTD'),
    mer
  };
}

function round(value, decimals = 2) {
  if (value === null || value === undefined || Number.isNaN(value)) return null;
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function weighted(funds, key) {
  const usable = funds.filter(fund => Number.isFinite(fund[key]) && Number.isFinite(fund.alloc));
  const alloc = usable.reduce((sum, fund) => sum + fund.alloc, 0);
  if (!alloc) return null;
  return usable.reduce((sum, fund) => sum + fund[key] * fund.alloc, 0) / alloc;
}

function recalculatePortfolio(portfolio) {
  portfolio.metrics.annualReturn1Y = round(weighted(portfolio.funds, 'y1'));
  portfolio.metrics.annualReturn3Y = round(weighted(portfolio.funds, 'y3'));
  portfolio.metrics.annualReturn5Y = round(weighted(portfolio.funds, 'y5'));
  portfolio.metrics.ytdReturn = round(weighted(portfolio.funds, 'ytd'));
}

function backupExistingData() {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dest = path.join(BACKUP_DIR, `portfolio_data.${stamp}.json`);
  fs.copyFileSync(DATA_FILE, dest);
  return dest;
}

async function fetchSource(name, source) {
  const url = `https://equitablelife.fundata.com/PDFReports/FundSummary/${source.id}?language=en`;
  const pdfPath = path.join(TMP_DIR, `${source.id}.pdf`);
  await download(url, pdfPath);
  const text = pdfToText(pdfPath);
  const parsed = parseFundSummary(text);
  return { name, url, ...source, ...parsed };
}

async function main() {
  execFileSync('pdftotext', ['-v'], { stdio: 'ignore' });
  fs.mkdirSync(TMP_DIR, { recursive: true });

  const current = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  const sourceEntries = Object.entries(FUND_SOURCES);
  const fetched = new Map();

  for (const [name, source] of sourceEntries) {
    const result = await fetchSource(name, source);
    fetched.set(name, result);
    console.log(`${name}: 1Y=${result.y1} 3Y=${result.y3} 5Y=${result.y5} MER=${result.mer ?? 'n/a'} asOf=${result.asOf.sourceLabel}`);
  }

  const dates = [...fetched.values()].map(item => item.asOf.sortKey).sort();
  const newestDate = dates[dates.length - 1];
  const newest = [...fetched.values()].find(item => item.asOf.sortKey === newestDate);

  for (const portfolio of Object.values(current.portfolios)) {
    for (const fund of portfolio.funds) {
      const update = fetched.get(fund.name);
      if (!update) throw new Error(`Missing source config for fund "${fund.name}"`);
      fund.y1 = round(update.y1, 1);
      fund.y3 = round(update.y3, 1);
      fund.y5 = round(update.y5, 1);
      if (Number.isFinite(update.ytd)) fund.ytd = round(update.ytd, 1);
      if (Number.isFinite(update.mer)) fund.mer = round(update.mer, 2);
      fund.source = {
        id: update.id,
        label: update.label,
        url: update.url,
        asOf: update.asOf.sourceLabel
      };
    }
    recalculatePortfolio(portfolio);
  }

  current.lastUpdated = newest.asOf.iso;
  current.asOfLabel = newest.asOf.label;
  current.dataSource = {
    ...current.dataSource,
    primary: 'Equitable Life Fundata FundSummary PDFs',
    url: 'https://equitablelife.fundata.com',
    lastAutomatedUpdate: new Date().toISOString(),
    updateMode: 'NAS monthly cron; official PDFs parsed with pdftotext',
    note: 'Fund returns are parsed from Equitable/Fundata FundSummary PDFs. Returns are net of MER when stated by source; guarantee fees are not included. Portfolio returns are allocation-weighted from fund-level returns.'
  };

  const backup = backupExistingData();
  fs.writeFileSync(DATA_FILE, `${JSON.stringify(current, null, 2)}\n`);
  fs.rmSync(TMP_DIR, { recursive: true, force: true });
  console.log(`Updated ${DATA_FILE}`);
  console.log(`Backup saved to ${backup}`);
}

main().catch(error => {
  try {
    fs.rmSync(TMP_DIR, { recursive: true, force: true });
  } catch {}
  console.error(error.stack || error.message);
  process.exit(1);
});
