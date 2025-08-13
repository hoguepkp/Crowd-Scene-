import 'dotenv/config';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import Database from 'better-sqlite3';
import { v4 as uuidv4 } from 'uuid';
import { RateLimiterMemory } from 'rate-limiter-flexible';
import fetch from 'node-fetch';
import http from 'http';
import { Server as SocketIOServer } from 'socket.io';

const app = express();
const server = http.createServer(app);
const io = new SocketIOServer(server, { cors: { origin: '*' } });

app.use(helmet());
app.use(cors());
app.use(express.json({ limit: '2mb' }));

// --- Config & DB ---
const DB_PATH = process.env.DB_PATH || './crowdscene.db';
const DECAY_HOURS = Number(process.env.DECAY_HOURS || 2);
const HOUR = 1000 * 60 * 60;
const TAU = DECAY_HOURS * HOUR;
const db = new Database(DB_PATH);

db.exec(`
PRAGMA journal_mode = WAL;
CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, name TEXT, created_at INTEGER);
CREATE TABLE IF NOT EXISTS venues (id TEXT PRIMARY KEY, name TEXT, type TEXT, lat REAL, lng REAL, cover INTEGER DEFAULT 0, url TEXT, event TEXT, created_at INTEGER);
CREATE TABLE IF NOT EXISTS checkins (id TEXT PRIMARY KEY, user_id TEXT, venue_id TEXT, ts INTEGER);
CREATE INDEX IF NOT EXISTS idx_checkins_venue_ts ON checkins(venue_id, ts);
CREATE TABLE IF NOT EXISTS reviews (id TEXT PRIMARY KEY, user_id TEXT, venue_id TEXT, stars INTEGER, text TEXT, ts INTEGER);
CREATE INDEX IF NOT EXISTS idx_reviews_venue_ts ON reviews(venue_id, ts);
`);

function now(){ return Date.now(); }
function toRad(d){ return d * Math.PI/180; }
function distMiles(aLat, aLng, bLat, bLng){
  const R = 3958.8;
  const dLat = toRad(bLat-aLat);
  const dLng = toRad(bLng-aLng);
  const s1 = Math.sin(dLat/2)**2 + Math.cos(toRad(aLat))*Math.cos(toRad(bLat))*Math.sin(dLng/2)**2;
  return 2*R*Math.asin(Math.sqrt(s1));
}
function crowdScore(venueId){
  const t = now();
  const rows = db.prepare('SELECT ts FROM checkins WHERE venue_id = ? AND ts > ?').all(venueId, t - (TAU*8));
  let score = 0;
  for(const r of rows){ score += Math.exp(-(t - r.ts)/TAU); }
  return score;
}

// Rate limiters
const ipLimiter = new RateLimiterMemory({ points: 100, duration: 60 });
const checkinLimiter = new RateLimiterMemory({ points: 3, duration: 60*30 });
app.use(async (req, res, next) => { try { await ipLimiter.consume(req.ip); next(); } catch { res.status(429).json({ error: 'Too many requests' }); } });

// Health
app.get('/health', (req,res) => res.json({ ok: true, time: Date.now() }));

// Users (anonymous)
app.post('/api/users/anon', (req,res) => {
  const id = uuidv4();
  const name = req.body?.name || 'Guest';
  db.prepare('INSERT INTO users (id, name, created_at) VALUES (?,?,?)').run(id, name, now());
  res.json({ id, name });
});

// Manual venues
app.post('/api/venues', (req,res) => {
  const { name, type, lat, lng, cover=0, url='', event='' } = req.body || {};
  if(!name || typeof lat !== 'number' || typeof lng !== 'number') return res.status(400).json({ error: 'Missing fields' });
  const id = uuidv4();
  db.prepare('INSERT INTO venues (id, name, type, lat, lng, cover, url, event, created_at) VALUES (?,?,?,?,?,?,?,?,?)').run(id, name, type, lat, lng, cover, url, event, now());
  res.json({ id });
});

app.get('/api/venues/nearby', (req,res) => {
  const lat = Number(req.query.lat), lng = Number(req.query.lng), radius = Number(req.query.radius || 5);
  if(Number.isNaN(lat) || Number.isNaN(lng)) return res.status(400).json({ error:'Bad coords' });
  const rows = db.prepare('SELECT * FROM venues').all();
  const mapped = rows.map(v => ({ ...v, distance: distMiles(lat,lng,v.lat,v.lng), crowd: crowdScore(v.id) }))
    .filter(v => v.distance <= radius)
    .sort((a,b) => b.crowd - a.crowd || a.distance - b.distance);
  res.json(mapped);
});

// Google Places proxy (live bars & clubs)
app.get('/api/places/nearby', async (req,res) => {
  const lat = Number(req.query.lat), lng = Number(req.query.lng), radiusMiles = Number(req.query.radius || 5);
  if(Number.isNaN(lat) || Number.isNaN(lng)) return res.status(400).json({ error:'Bad coords' });
  const key = process.env.GOOGLE_PLACES_API_KEY;
  if(!key) return res.status(500).json({ error:'Set GOOGLE_PLACES_API_KEY' });
  const radiusMeters = Math.min(40000, Math.round(radiusMiles * 1609.34));
  const url = `https://maps.googleapis.com/maps/api/place/nearbysearch/json?location=${lat},${lng}&radius=${radiusMeters}&type=bar&keyword=bar%20OR%20nightclub&key=${key}`;
  const r = await fetch(url);
  const data = await r.json();
  const results = (data.results || []).map(p => ({
    id: p.place_id,
    name: p.name,
    type: (p.types || []).includes('night_club') ? 'Night Club' : 'Bar',
    lat: p.geometry?.location?.lat,
    lng: p.geometry?.location?.lng,
    cover: 0,
    url: p.website || '',
    event: '',
    distance: distMiles(lat,lng,p.geometry?.location?.lat,p.geometry?.location?.lng),
    crowd: crowdScore(p.place_id)
  }));
  res.json(results);
});

// Check-ins
app.post('/api/checkins', async (req,res) => {
  const { userId, venueId } = req.body || {};
  if(!userId || !venueId) return res.status(400).json({ error:'Missing fields' });
  const key = `${userId}:${venueId}`;
  try { await checkinLimiter.consume(key, 1); }
  catch { return res.status(429).json({ error:'Too many check-ins. Try later.' }); }
  const id = uuidv4();
  db.prepare('INSERT INTO checkins (id, user_id, venue_id, ts) VALUES (?,?,?,?)').run(id, userId, venueId, Date.now());
  io.emit('crowd:update', { venueId, crowd: crowdScore(venueId) });
  res.json({ id, crowd: crowdScore(venueId) });
});

// Reviews
app.post('/api/reviews', (req,res) => {
  const { userId, venueId, stars, text } = req.body || {};
  if(!userId || !venueId || !stars) return res.status(400).json({ error:'Missing fields' });
  const id = uuidv4();
  db.prepare('INSERT INTO reviews (id, user_id, venue_id, stars, text, ts) VALUES (?,?,?,?,?,?)')
    .run(id, userId, venueId, Math.max(1,Math.min(5,stars)), text || '', Date.now());
  res.json({ id });
});

const PORT = process.env.PORT || 4000;
server.listen(PORT, () => console.log(`CrowdScene backend listening on :${PORT} (db=${DB_PATH})`));
