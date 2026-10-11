# Skill Smith web

The one-screen demo: robot theater (v0 vs best harness), hill climb, night shift (durable queue + recovery),
evolution feed, and a "Pack it" form for judges. Next.js 15 (App Router) + Tailwind 4, reads MongoDB Atlas on the
server and polls `/api/state` once a second.

## Run

```bash
cd web
ln -sfn ../.env.local .env.local   # once; MONGODB_URI and MONGODB_DB live in the repo-root .env.local
npm install
npm run dev                        # http://localhost:3000
```

If the symlink is missing, `next.config.ts` loads `../.env.local` itself. Without `MONGODB_URI` the page runs on
sample data.

For the projector use a production build: `npm run build && npm start`.

## Modes

| URL | What it shows |
| --- | --- |
| `/` | Atlas. Any empty collection falls back to sample data and its panel says `sample`. |
| `/?mock=1` | Sample data only (`src/lib/mock.ts`); the queue moves with the clock. |
| `/?replay=1` | `public/replay.json`: one state, or an array of states played back at 1 frame/s. No Atlas needed. |
| `/?view=v0`, `best`, `live` | Opens the theater on one screen. |

Keys: `1` v0 vs best, `2` v0, `3` best, `4` or `L` live order. A new judge order cuts to the live view.

Record a real run for offline playback (demo insurance):

```bash
npm run record-replay -- 90 http://localhost:3000/api/state public/replay.json
```

## API

- `GET /api/state`: everything the screen needs (`src/lib/types.ts` → `AppState`). `no-store`.
- `POST /api/live-order` `{name, product_id}`: inserts `{name, product_id, status: "new", created_at}` into
  `live_requests`. Name 1 to 40 chars; product must be a `train` product. One request per client per 4 s.

The web never reads `skillsmith_truth`, and `live_requests` is the only collection it writes.

## Media

The core writes `public/videos/*.mp4` and `public/frames/*.png` (gitignored). `public/placeholder/` holds a
small clip and frame so the layout works before the first render.
