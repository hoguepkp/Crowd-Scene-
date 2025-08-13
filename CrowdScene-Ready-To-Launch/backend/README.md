# CrowdScene Backend

## Run locally
```bash
cd backend
cp .env.example .env
npm install
npm run start
```
Then open: http://localhost:4000/health

## Deploy on Render
- Push repo to GitHub.
- Render → New → Web Service (uses render.yaml).
- Add env var: GOOGLE_PLACES_API_KEY
- (Optional) add a Disk and set DB_PATH=/data/crowdscene.db
