const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const { refreshOnce, addRefreshListener } = require('./refresher');

// Helper: read a JSON-like text file and parse it
const readJsonFile = (relativePath) => {
    const abs = path.join(__dirname, relativePath);
    const content = fs.readFileSync(abs, 'utf8');
    // Files in full_responses are valid JSON text
    return JSON.parse(content);
};

// Stable, short, lowercase [a-z0-9] 6-char id from conceptId
// Deterministic: uses a simple FNV-1a 32-bit hash and base36 encoding
const fnv1a32 = (str) => {
    let h = 0x811c9dc5; // FNV offset basis
    for (let i = 0; i < str.length; i++) {
        h ^= str.charCodeAt(i);
        // 32-bit FNV prime multiplication: (h * 16777619) mod 2^32
        h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
    }
    return h >>> 0;
};

const shortId = (conceptId) => {
    const n = fnv1a32(String(conceptId));
    const base36 = n.toString(36).toLowerCase();
    // Ensure fixed length 6: pad start with zeros then slice last 6
    return ("000000" + base36).slice(-6);
};

// Map game object to expected public shape (without conceptUrl and device)
const toPublicGame = (g) => ({
    id: shortId(g.conceptId),
    conceptId: g.conceptId,
    name: g.name,
    nameEn: g.nameEn,
    gameUrl: g.conceptUrl,
    imageUrl: g.imageUrl,
    available_on: g.device,
    releaseDate: g.releaseDate,
});

// Cache to keep responses in-memory for speed
const cache = {
    included: null,
    classics: null,
    monthly: null,
    ubisoft: null,
    all: null,
};

// Invalidate cache when a refresh completes successfully
addRefreshListener(() => {
    cache.included = null;
    cache.classics = null;
    cache.monthly = null;
    cache.ubisoft = null;
    cache.all = null;
});

// Load and flatten games from grouped catalog responses
const loadGroupedGames = (fileRelPath) => {
    const data = readJsonFile(fileRelPath); // array of { catalogKey, count, games }
    // Flatten all grouped games
    const games = data.flatMap(group => group.games || []);
    return games;
};

const sortByName = (arr) => arr.slice().sort((a, b) => a.name.localeCompare(b.name));

// Data will be fetched from 4 endpoints:
// https://www.playstation.com/bin/imagic/gameslist?locale=en-in&categoryList=plus-games-list
// https://www.playstation.com/bin/imagic/gameslist?locale=en-in&categoryList=ubisoft-classics-list
// https://www.playstation.com/bin/imagic/gameslist?locale=en-in&categoryList=plus-classics-list
// https://www.playstation.com/bin/imagic/gameslist?locale=en-in&categoryList=plus-monthly-games-list
// and will be served via the following routes according to the specification, written in the comments below.

router.get('/', (req, res) => {
    res.json({ about: 'Retrieve the current PlayStation Plus Extra Catalogue' });
});

router.get('/status', (req, res) => {
    res.json({ status: 'OK' });
});

router.get('/routes', (req, res) => {
    res.json({ routes: ['/all-games',
        '/included-classics',
        '/included-games',
        '/monthly-games',
        '/ubisoft-classics',
        '/all-data',
        'POST /admin/refresh'
    ] });
});


router.get('/all-games', (req, res) => {
    //Returns a list of all games, from all 4 endpoints, sorted in alphabetical order
    //Expected response of this route is included in './expected_response/all.txt' file
    try {
        if (!cache.all) {
            const included = loadGroupedGames('./full_responses/plus-games-list.txt');
            const classics = loadGroupedGames('./full_responses/plus-classics-list.txt');
            const monthly = loadGroupedGames('./full_responses/plus-monthly-games-list.txt');
            const ubisoft = loadGroupedGames('./full_responses/ubisoft-classics-list.txt');

            // Merge and de-duplicate by conceptId
            const byId = new Map();
            for (const g of [...included, ...classics, ...monthly, ...ubisoft]) {
                if (!byId.has(g.conceptId)) byId.set(g.conceptId, g);
            }
            const games = sortByName(Array.from(byId.values())).map(toPublicGame);
            cache.all = [
                {
                    catalogueName: 'All',
                    description: 'Every game from every catalogue',
                    count: games.length,
                    games,
                },
            ];
        }
        res.json(cache.all);
    } catch (e) {
        res.status(500).json({ error: 'Failed to build all-games', details: String(e) });
    }
});

router.get('/included-classics', (req, res) => {
    //Returns data from 'plus-classics-list' endpoint
    // the entire response of this endpoint is included in './full_responses/plus-classics-list.txt' file
    //Expected response of this route is also included in './expected_response/included_classics.txt' file
    try {
        if (!cache.classics) {
            const groups = readJsonFile('./full_responses/plus-classics-list.txt');
            const games = sortByName(groups.flatMap(g => g.games || [])).map(toPublicGame);
            cache.classics = [
                {
                    catalogueName: 'Playstation Plus Classic Games',
                    description: 'Classic Games from Playstation history, available on Plus Extra tier and above',
                    count: games.length,
                    games,
                },
            ];
        }
        res.json(cache.classics);
    } catch (e) {
        res.status(500).json({ error: 'Failed to load classics', details: String(e) });
    }
});

router.get('/included-games', (req, res) => {
    //Returns data from 'plus-games-list' endpoint
    // the entire response of this endpoint is included in './full_responses/plus-games-list.txt' file
    //Expected response of this route is also included in './expected_response/included_games.txt' file
    try {
        if (!cache.included) {
            const groups = readJsonFile('./full_responses/plus-games-list.txt');
            const games = sortByName(groups.flatMap(g => g.games || [])).map(toPublicGame);
            cache.included = [
                {
                    catalogueName: 'Playstation Plus Included Games',
                    description: 'Vast collection of games available on Plus Extra tier and above',
                    count: games.length,
                    games,
                },
            ];
        }
        res.json(cache.included);
    } catch (e) {
        res.status(500).json({ error: 'Failed to load included games', details: String(e) });
    }
});

router.get('/monthly-games', (req, res) => {
    //Returns data from 'plus-monthly-games-list' endpoint
    // the entire response of this endpoint is included in './full_responses/plus-monthly-games-list.txt' file
    //Expected response of this route is also included in './expected_response/monthly_games.txt' file
    try {
        if (!cache.monthly) {
            const groups = readJsonFile('./full_responses/plus-monthly-games-list.txt');
            const games = sortByName(groups.flatMap(g => g.games || [])).map(toPublicGame);
            cache.monthly = [
                {
                    catalogueName: 'Playstation Plus Monthly Games',
                    description: 'A fresh selection of games refreshed every month, and yours to keep for as long as you’re a member',
                    count: games.length,
                    games,
                },
            ];
        }
        res.json(cache.monthly);
    } catch (e) {
        res.status(500).json({ error: 'Failed to load monthly games', details: String(e) });
    }
});
router.get('/ubisoft-classics', (req, res) => {
    //Returns data from 'ubisoft-classics-list' endpoint
    // the entire response of this endpoint is included in './full_responses/ubisoft-classics-list.txt' file
    //Expected response of this route is also included in './expected_response/ubisoft_classics.txt' file
    try {
        if (!cache.ubisoft) {
            const groups = readJsonFile('./full_responses/ubisoft-classics-list.txt');
            const games = sortByName(groups.flatMap(g => g.games || [])).map(toPublicGame);
            cache.ubisoft = [
                {
                    catalogueName: 'Included Ubisoft Classic Games',
                    description: "A curated selection of Ubisoft's Classic Hits, available on Plus Extra tier and above",
                    count: games.length,
                    games,
                },
            ];
        }
        res.json(cache.ubisoft);
    } catch (e) {
        res.status(500).json({ error: 'Failed to load ubisoft classics', details: String(e) });
    }
});

// Serve the merged all.txt content directly as stored (raw JSON parse)
router.get('/all-data', (req, res) => {
    try {
        const abs = path.join(__dirname, './full_responses/all.txt');
        const txt = fs.readFileSync(abs, 'utf8');
        const json = JSON.parse(txt);
        res.json(json);
    } catch (e) {
        res.status(500).json({ error: 'Failed to load all-data', details: String(e) });
    }
});

// Simple auth guard using header x-admin-token (can be replaced with env/config)
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || 'dev-admin-token';
router.post('/admin/refresh', async (req, res) => {
    try {
        const token = req.headers['x-admin-token'];
        if (!token || token !== ADMIN_TOKEN) {
            return res.status(401).json({ error: 'Unauthorized' });
        }
        const result = await refreshOnce();
        if (result?.inProgress) {
            return res.status(202).json({ message: 'Refresh already in progress' });
        }
        return res.json({ status: 'OK', ...result });
    } catch (e) {
        res.status(500).json({ error: 'Failed to refresh', details: String(e) });
    }
});
module.exports = router;