# QA findings — 2026-09-26

Black-box and code-assisted testing of the running app (`npm start`, localhost:3000), in the
order: basic UI → PGN → search → explorer → PGN nastiness → position editor → Stockfish →
110k-game TWIC import. Correctness was checked against **python-chess** as an independent
oracle wherever possible. No application code was changed.

Test data: `fixtures/` (hand-written edge cases), 800 real games (TWIC 1502), and 16 TWIC
issues spread over 2019–2025 (111,560 games; 110,419 standard + 1,141 Chess960).

## Severity summary

| # | Severity | Area | Summary |
|---|---|---|---|
| 1 | **Critical** | server/search | Position search can freeze the whole server for minutes (stale planner stats) |
| 2 | High | import/open | Consecutive tag-less games are silently dropped |
| 3 | High | PGN parser | Moves with attached glyphs (`e4±`, `Qxf7!#`) are dropped; can truncate a game to 0 moves |
| 4 | Medium | search | Opponent filter matches the player's own side; opponent-only is silently ignored |
| 5 | Medium | PGN writer / analysis | Writer wraps inside comments → `[%eval` split → evals duplicated on re-analysis |
| 6 | Medium | import | Dedupe fingerprint differs between a game and its own export (missing Event/Round) |
| 7 | Medium | import perf | UI import ~10× slower than CLI (each file is its own non-staged job) |
| 8 | Medium | Open dialog | Latin-1 files opened (not imported) are decoded as UTF-8 → mojibake |
| 9 | Medium | Open dialog | Invalid FEN tag is ignored and moves are played from the standard start |
| 10 | Low | search | "Both ≤" Elo filter includes games with one rating missing |
| 11 | Low/UX | various | No undo/redo; no e.p. field in editor; no mate/stalemate label; see list below |

---

### 1. Critical — position search freezes the server

**Symptom.** After importing TWIC through the UI, a "Find games with this position" search
(Najdorf) on the running server never returned; `/api/info` stopped answering too. The server
sat at 100% of one core for >10 minutes.

**Root cause.** The server's long-lived better-sqlite3 connection loads `sqlite_stat1` once.
Imports run in a worker thread on a *separate* connection; its `ANALYZE`
(`importer/import.ts:450`) does not refresh the statistics the server connection already has.
A server started on a small DB therefore keeps planning `positions ⋈ games` as if `games` had
1 row: it walks all games in `ORDER BY` order and probes the position index per game
(O(games × rows-for-hash)). better-sqlite3 is synchronous, so the event loop is blocked for the
whole query.

**Evidence** (`repro/position-search-freeze.cjs`, 110k games):

| Setup | Najdorf (3,090 games) | Sicilian 2…d6 |
|---|---|---|
| Freshly started server | 65 ms | — |
| Server holding 1-game stats | **44 s** | — |
| …after `ANALYZE` from another connection | — | **106 s** |

Direct queries on a fresh connection: 1.e4 (52,463 games) 138 ms, Najdorf 46 ms.

**Fix ideas.** Force the join order in `packages/server/src/search.ts:246` / `:291`
(`positions p CROSS JOIN games g` — SQLite never reorders a CROSS JOIN); and/or re-run
`ANALYZE` (or reopen) on the main connection in the job-finished callback (`server.ts:141`).
Consider running heavy queries off the main thread or with a progress-handler timeout.

**Workaround.** Restart the server after large imports.

### 2. High — tag-less games silently dropped

`PgnSplitter` (`packages/core/src/pgn.ts:751`) only starts a new game at a `[` at line start.
Games without tag pairs separated by blank lines stay in one chunk; `parseGame` keeps the first.
No error or warning is reported.

- Import: `1. d4 d5 *\n\n1. e4 c5 2. Nf3 d6 *` → 1 game imported, 0 errors.
- Open dialog: files < 400 KB use `parsePgn` (correct, 23/23 games), files ≥ 400 KB use the
  splitter (`web/src/state/gameStore.ts:25-35`) → 822/823 games.
- Repro: `repro/splitter-drops-tagless-games.ts`.

### 3. High — moves with attached glyphs dropped (`pgn.ts:261-271`)

Only trailing `!`/`?` are split off a SAN token; anything else that fails `MOVE_TOKEN` is discarded.

- `1. e4± e5 2. Nf3 Nc6` → game imported with **0 plies**; warning blames `"e5" at ply 1`.
- `4. Qxf7!# 1-0` → the mating move silently disappears (6 plies, no warning).

### 4. Medium — opponent filter (`server/src/search.ts:113-127`)

Checked against the oracle on 110k games:

| Query | App | Correct |
|---|---|---|
| player=Carlsen & opponent=Carlsen | 228 | 0 |
| opponent=Carlsen (no player) | 110,419 (all) | 228 |

For `color=any` the player and opponent conditions are OR-ed independently; it needs
`(W∈P AND B∈O) OR (B∈P AND W∈O)`. The opponent-only case is inside `if (q.player)`. The UI always
shows the Opponent box and displays an active "opponent: Carlsen" badge over an unfiltered list
(`screenshots/p3-opponent-only.png`). Similarly `result=win|loss|draw` without a player, and
unparseable dates/ECO (`2019.??.??`, `)(`), are silently dropped rather than rejected.

### 5. Medium — comment wrapping corrupts `[%eval]` (`pgn.ts:488-497`)

The line writer wraps comment words, so long comments come back with `[%eval\n0.23]`. In
practice: analyse a game → Add to notation → Download PGN → the file had 9 split evals.
Re-opening it and analysing again: `gameAnalysis.ts:146` strips only `/\[%eval [^\]]*\]/`, so
the split ones survive → **84 → 93 evals**. (`ui/phase7.cjs` + `ui/reanalyse.cjs`.)

### 6. Medium — re-importing an export creates duplicates (`importer/process.ts:201`)

The fingerprint uses raw `h.Event ?? ''` / `h.Round ?? ''`, but export writes `"?"`. Importing
the original file into a DB that already holds its export: 1 new game (the one without
Event/Round) instead of all duplicates. Round-tripping export → fresh DB → re-import of the
same export is fine (822 duplicates).

### 7. Medium — UI import ~10× slower than CLI

Same 16 TWIC files: **UI 670 s** (500 → 39 games/s as the DB grew) vs **CLI 71 s**
(~1,550 games/s). The UI uploads each file as a separate job (`web/.../Dialogs.tsx:171`); each
is < 32 MB and the DB is non-empty, so none takes the staged/bulk path (`import.ts:336`) and
every position row is inserted into the fully indexed table. Submitting a multi-file upload as
one job (or staging whenever the batch is large relative to the DB) would fix it.

### 8. Medium — Latin-1 in the Open dialog

`OpenPgnDialog.openFile` uses `File.text()` (UTF-8 only): names show as `M�ller, J�rgen`.
Import of the same file is correct (UTF-8 → Windows-1252 fallback in `import.ts:273`).

### 9. Medium — invalid FEN tag ignored when opening (`pgn.ts:319-337`)

`[SetUp "1"][FEN "4k3/8/8/8/8/8/8/4K2R w X - 0 1"] 1. e4 e5 2. Nf3` → "Game opened", moves
played from the standard start position, bad FEN header kept. Affects Chess960 games with X-FEN
castling letters. (Import correctly rejects it.)

### 10. Low — "Both ≤" Elo filter

`maxElo=1500`: app 1,039, oracle 336. `max_elo` is computed from the one known rating
(`import.ts:155-156`), so games with an unrated player pass "Both ≤ 1500"; `minElo` correctly
requires both.

### 11. Low / UX

- No undo/redo; "Delete from here" (move context menu) has no confirmation.
- Position editor has no en-passant field (FEN is always `- 0 1`); its FEN box is read-only.
  (E.p. positions can be entered via the main FEN box — works.)
- Checkmate / stalemate positions get no label (only a red king glow); engine shows a bare `#`.
- After clearing the player, a stale "result: loss" badge stays active while the Result select
  shows "Any result".
- Castling checkboxes stay ticked when the right is silently dropped from the FEN.
- Non-ASCII case-insensitive search: `müller` matches, `MÜLLER` doesn't (SQLite NOCASE is ASCII-only).
- 1,141 Chess960 games in TWIC rejected ("Unsupported variant").
- Position search/explorer only cover the first 60 plies (documented) — no hint in the UI.

### Reported by code review, not reproduced in the UI

(see `repro/core/t1-t9.ts`)
- PGN `Opening`/`Variation` tags are dropped on import (`process.ts:47-49`).
- `[Result "?"]` written verbatim as the termination token (`pgn.ts:551`).
- Tokens like `constructor` are parsed as NAGs (`pgn.ts:256`, plain-object lookup).
- Zobrist hash differs between incremental play and `fromFen` after a pinned e.p. double push
  (`position.ts:197` vs `:203/247/396`).
- `parseSan('0000')` returns -1 (`position.ts:735-740`).
- `/api/games?offset=1e20` and `/api/explorer?games=2.5` → 500; `games=-1` → no limit.

---

## What passed

**Basic UI** — board loads; drag & click-to-move; illegal moves rejected; off-board drag;
start/back/forward/end buttons; ←/→/Home/End keys (ignored while typing in the FEN box);
mouse wheel; variations created without duplicating existing moves; ↑/↓ switch variations;
context menu (make main line, delete); flip via button and `F`; light/dark/system theme,
persisted across reload; unsaved-changes warning on unload.

**PGN** — 821 imported (+1 dropped, bug 2; +1 my own invalid FEN, correctly rejected).
All 800 TWIC games identical to source (moves, headers, comments, NAGs, variations).
Walking 29 games move by move in the UI: every FEN identical to python-chess. Nested
variations, comments with parens/braces/move-like text, `;` comments, all NAG forms, `%clk`,
`%cal` arrows, `%csl` circles, missing headers, promotions (incl. `a8Q`, underpromotion),
castling (`0-0`, `O-O-O`), en passant, checkmate, stalemate, games with no moves, weird SAN
(`Ng1f3`, `e2-e4`, `Nf3xd4`, `Qh4e1`), Black-to-move FEN start, escaped tag values, null moves,
a 700-ply game. Illegal move mid-game → truncated with a clear error; next game unaffected.
UI export → re-import into a fresh DB is lossless.

**Search** — 30/36 oracle queries exact, 1–161 ms on 110k games: player (substring, case,
exact), white/black/color, player+opponent, event, site, date ranges, min Elo, result, ECO
(code, prefix, range), length, and combinations. *Carlsen + Black + 2019–2025 + decisive* =
56 wins + 13 losses — exact, in the UI as well.

**Explorer** — exact match with the oracle for the start position, 1.e4, 1.e4 e5, 1.e4 c5,
1.d4 Nf6: totals, W/D/B, per-move counts and games ended. Transpositions (QGD, Najdorf via
1.Nf3, Nimzo via 1.c4, Catalan via 1.c4) give identical stats via API and UI. Clicking an
explorer move plays it.

**Position editor** — validates kings, back-rank pawns, side-not-to-move in check; castling
rights; castling by king-2-squares and king-onto-rook; Black to move; promotion picker
(underpromotion, capture-promotion, Escape cancels); e.p. via FEN; exported PGN has correct
`SetUp`/`FEN`.

**Stockfish (WASM)** — first line in ~1 s; eval changes with position, White POV sign; multi-PV
1/2/5 with distinct lines; all 260 PV moves legal (python-chess); finds mate in 1; clicking a PV
move plays it; mate/stalemate positions don't crash; PV numbering correct for Black-to-move at
move 30; whole-game analysis of 84 plies at depth 10 in 5 s, graph + click-to-jump, Add to
notation idempotent within a session, Stop works. No page errors in any run.

**TWIC scale** — 110,419 games imported = oracle count; the 2 truncated games are genuinely
illegal in the source (python-chess agrees).
