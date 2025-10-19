const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const axios = require('axios');

const BASE_DIR = __dirname;
const FULL_DIR = path.join(BASE_DIR, 'full_responses');

// Endpoints
const ENDPOINTS = {
  'plus-games-list.txt': 'https://www.playstation.com/bin/imagic/gameslist?locale=en-in&categoryList=plus-games-list',
  'ubisoft-classics-list.txt': 'https://www.playstation.com/bin/imagic/gameslist?locale=en-in&categoryList=ubisoft-classics-list',
  'plus-classics-list.txt': 'https://www.playstation.com/bin/imagic/gameslist?locale=en-in&categoryList=plus-classics-list',
  'plus-monthly-games-list.txt': 'https://www.playstation.com/bin/imagic/gameslist?locale=en-in&categoryList=plus-monthly-games-list',
};

const THREE_DAYS_MS = 2 * 24 * 60 * 60 * 1000;
let isRefreshing = false;
const listeners = [];

function addRefreshListener(fn) {
  if (typeof fn === 'function') listeners.push(fn);
}

async function ensureDir(dir) {
  await fsp.mkdir(dir, { recursive: true });
}

async function fetchRaw(url) {
  const res = await axios.get(url, {
    responseType: 'text',
    // Keep response as raw JSON text so we do not alter formatting/ordering
    headers: { 'Accept': 'application/json' },
    timeout: 30000,
    transitional: { clarifyTimeoutError: true },
  });
  return res.data;
}

function filePath(name) {
  return path.join(FULL_DIR, name);
}

async function statOrNull(p) {
  try {
    return await fsp.stat(p);
  } catch (e) {
    return null;
  }
}

async function needsRefresh() {
  // If any of the 4 files is missing or older than 3 days, refresh.
  const now = Date.now();
  for (const name of Object.keys(ENDPOINTS)) {
    const p = filePath(name);
    const st = await statOrNull(p);
    if (!st) return true;
    if (now - st.mtimeMs > THREE_DAYS_MS) return true;
  }
  return false;
}

async function writeFileRaw(p, data) {
  await fsp.writeFile(p, data, 'utf8');
}

function sortByName(games) {
  return games.slice().sort((a, b) => {
    const an = (a && a.name) || '';
    const bn = (b && b.name) || '';
    return an.localeCompare(bn);
  });
}

async function generateAllMerged() {
  // Read the 4 raw files, parse, flatten games, sort by name, and write to full_responses/all.txt
  const names = Object.keys(ENDPOINTS);
  const rawArr = await Promise.all(
    names.map(async (n) => {
      const txt = await fsp.readFile(filePath(n), 'utf8');
      return txt;
    })
  );
  // Parse JSON
  const parsed = rawArr.map((txt) => JSON.parse(txt));
  const allGames = parsed.flatMap(grouped => (grouped || []).flatMap(g => g.games || []));
  const gamesSorted = sortByName(allGames);
  const allPayload = [
    {
      catalogKey: 'ALL',
      count: gamesSorted.length,
      games: gamesSorted,
    },
  ];
  const out = JSON.stringify(allPayload, null, 2);
  await writeFileRaw(filePath('all.txt'), out);
}

async function refreshOnce() {
  if (isRefreshing) return { inProgress: true };
  isRefreshing = true;
  const statuses = {};
  try {
    await ensureDir(FULL_DIR);
    // Fetch all in parallel
    const entries = Object.entries(ENDPOINTS);
    const results = await Promise.allSettled(
      entries.map(async ([fname, url]) => {
        const data = await fetchRaw(url);
        await writeFileRaw(filePath(fname), data);
        const ts = new Date().toISOString();
        statuses[fname] = `${fname} refreshed on ${ts} successfully`;
        return fname;
      })
    );
    const anyRejected = results.some(r => r.status === 'rejected');
    if (!anyRejected) {
      // Generate merged file only if all source files succeeded
      await generateAllMerged();
      const ts = new Date().toISOString();
      statuses['all.txt'] = `all.txt refreshed on ${ts} successfully`;
      // Notify listeners about a successful refresh
      try {
        for (const fn of listeners) fn({ statuses });
      } catch (e) {
        console.error('[refresher] listener error:', e?.message || e);
      }
    }
    return { anyRejected, statuses };
  } catch (e) {
    // Swallow errors to avoid crashing the app; log for visibility
    console.error('[refresher] refresh failed:', e?.message || e);
    return { error: e?.message || String(e), statuses };
  } finally {
    isRefreshing = false;
  }
}

async function maybeRefresh() {
  try {
    if (await needsRefresh()) {
      await refreshOnce();
    }
  } catch (e) {
    console.error('[refresher] maybeRefresh error:', e?.message || e);
  }
}

function scheduleRefresh() {
  // Check on startup
  maybeRefresh();
  // Then check daily; refresh triggers only when older than 3 days
  const ONE_DAY_MS = 24 * 60 * 60 * 1000;
  setInterval(maybeRefresh, ONE_DAY_MS).unref?.();
}

module.exports = {
  scheduleRefresh,
  refreshOnce,
  maybeRefresh,
  addRefreshListener,
};
