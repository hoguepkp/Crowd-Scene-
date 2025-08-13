# CrowdScene — Ready To Launch

This repo includes:
- `backend/` — Node/Express API (SQLite, Google Places proxy, check-ins, reviews, Socket.IO)
- `web/` — Google Maps client
- `mobile/` — Expo React Native starter

## Deploy on Render
1) Push this repo to GitHub.
2) In Render: New → Web Service → select repo (it reads render.yaml and builds `backend/`).
3) Add **Environment Variables**:
   - `GOOGLE_PLACES_API_KEY` = your Google key (Maps JavaScript API + Places API enabled; billing on)
   - (Optional) `DB_PATH=/data/crowdscene.db` and attach a **Disk** for persistence
   - (Optional) `DECAY_HOURS=2`
4) Healthcheck: `https://<your-url>/health`
5) Test: `https://<your-url>/api/places/nearby?lat=37.7749&lng=-122.4194&radius=5`

## Point clients at your live URL
- `web/index.html` → set `API_BASE` to your Render URL and replace `YOUR_GOOGLE_MAPS_API_KEY` in script tag
- `mobile/App.js` → set `API_URL` to your Render URL, then `npx expo start`

## Local dev
```bash
cd backend
cp .env.example .env
npm install
npm run start
# open http://localhost:4000/health
```
