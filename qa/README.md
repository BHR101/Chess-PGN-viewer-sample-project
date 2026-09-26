# QA test kit

Manual/exploratory test tooling used for the findings in [FINDINGS.md](FINDINGS.md).
Nothing here runs in CI; everything targets a running server.

```
fixtures/   hand-written edge-case PGNs (nasty.pgn, glyph.pgn, badfen.pgn, latin1.pgn, long.pgn)
ui/         Playwright scripts driving the web UI (headless Edge)
oracle/     python-chess oracle + comparisons against the HTTP API
repro/      minimal reproductions of confirmed bugs (repro/core: parser/position checks)
data/       fetch_twic.sh — downloads the TWIC issues used for the 110k test
screenshots/ selected screenshots referenced by FINDINGS.md
out/        generated output (git-ignored)
```

## Setup

```bash
npm install && npm run build
npm start                      # or: node packages/server/dist/cli.js serve --db /tmp/qa.sqlite --port 3300
pip install chess              # for oracle/
bash qa/data/fetch_twic.sh     # ~35 MB download, ~110 MB unzipped
python qa/oracle/make_fixtures.py
```

The UI scripts use the system Microsoft Edge through Playwright (`channel: 'msedge'`), so no
Playwright browser download is needed. Point them at a server with `PGNX_URL`
(default `http://localhost:3000`). Scripts that import data modify that server's database —
use a throw-away `--db` for anything except the import you actually want.

## UI scripts (`node qa/ui/<script>`)

| Script | What it checks |
|---|---|
| `phase1.cjs` | board, drag/click moves, navigation buttons & keys, wheel, variations, context menu, flip, theme |
| `import_ui.cjs FILE...` | imports files through the Import dialog and prints job stats |
| `walk.cjs ID...` | opens games by id and steps through every move, dumps FENs/comments/NAGs to `out/walk.json` |
| `csl.cjs` | `%cal`/`%csl` rendering (expects the "Clock and arrows" game at id 805 — adjust) |
| `open_ui.cjs FILE...` | opens files with the Open dialog (game count, Latin-1 decoding) |
| `export_ui.cjs` | downloads the whole DB via the Export link to `out/exported.pgn` |
| `phase3ui.cjs` | combined search, stale result filter, opponent-only filter, position search |
| `phase4ui.cjs` | explorer + transpositions through the UI |
| `phase6.cjs` | position editor validation, castling, promotion, e.p., export |
| `phase7.cjs` | Stockfish: start, eval, multi-PV, mate-in-1, click-to-play, whole-game analysis |
| `reanalyse.cjs` | re-opens `out/analysed.pgn` and re-analyses it (duplicate-eval bug) |
| `badfen_ui.cjs` | opens `fixtures/badfen.pgn` (invalid FEN tag bug) |
| `capture_requests.cjs` | logs the API requests the UI sends for a position search |

## Oracle (`qa/oracle`)

```bash
python qa/oracle/oracle.py                       # parse all TWIC files → out/oracle.json
python qa/oracle/search_check.py  [BASE_URL]     # 36 search queries, app vs oracle
python qa/oracle/explorer_check.py [BASE_URL]    # explorer stats + transpositions vs oracle
python qa/oracle/compare.py SOURCE.pgn [BASE_URL] [--ids-from=N]   # DB games vs source PGN
```

Use a database that contains exactly the TWIC files (e.g. `pgnx import qa/data/twic/*.pgn --db
/tmp/twic.sqlite`) for exact counts. Use `127.0.0.1` rather than `localhost` on Windows —
`localhost` tries IPv6 first and adds ~2 s per request.

## Repros

```bash
node qa/repro/position-search-freeze.cjs /tmp/twic.sqlite          # bug 1
cd packages/server && node --conditions=development --import tsx ../../qa/repro/position-query-timing.ts /tmp/twic.sqlite "FEN"
cd packages/core && node --conditions=development --import tsx ../../qa/repro/splitter-drops-tagless-games.ts   # bug 2
cd packages/core && node --conditions=development --import tsx ../../qa/repro/core/t1.ts                       # t1..t9
```
