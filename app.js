require('dotenv').config();
const express = require('express');
const app = express();
const port = 3000;

const routes = require('./routes');
const { scheduleRefresh } = require('./refresher');

app.use('/', routes);

app.listen(port, () => {
    console.log(`App listening at http://localhost:${port}`);
    try {
        scheduleRefresh();
        console.log('Data refresh scheduler started');
    } catch (e) {
        console.error('Failed to start refresh scheduler:', e?.message || e);
    }
});