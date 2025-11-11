# PS Plus Catalogue API

A fast, clean Express API that serves the current PlayStation Plus catalogues using pre-fetched responses stored locally in `full_responses/`.

## Endpoints

- GET `/` – About
- GET `/status` – Health check
- GET `/included-games` – Plus Included Games
- GET `/included-classics` – Plus Classic Games
- GET `/monthly-games` – Monthly Games
- GET `/ubisoft-classics` – Ubisoft Classics
- GET `/all-games` – All games from all catalogues, de-duplicated and sorted by name
- GET `/all-games` – All games from all catalogues, de-duplicated and sorted by name
- GET `/all-data` – Raw merged content from `full_responses/all.txt` (sorted by name)
- POST `/admin/refresh` – Manually refresh source files and regenerate all.txt (requires header `x-admin-token`)

Each catalogue response is shaped like the examples in `expected_response/` with:
- Top-level array of a single object `{ catalogueName, description, count, games }`
- Each game contains `id` (6-char lowercase alphanumeric derived from conceptId), `conceptId`, `name`, `nameEn`, `gameUrl`, `imageUrl`, `available_on` and `releaseDate`.

## Run locally

Install dependencies and start the server:

```powershell
npm install
node app.js
```

## Notes
- Data is loaded from the files in `full_responses/` and cached in-memory on first request for speed.
- Sorting is case-sensitive locale compare by `name`.
- If upstream formats change, adjust the mapper in `routes.js`.
- Background refresh: Data is refreshed automatically every 3 days (checked daily). You can force an update:

```powershell
$headers = @{ 'x-admin-token' = 'dev-admin-token' }
Invoke-WebRequest -UseBasicParsing -Method Post -Headers $headers http://localhost:3000/admin/refresh
```
