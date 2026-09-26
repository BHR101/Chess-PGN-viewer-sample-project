"""Compare games in the running DB against a source PGN using python-chess.
usage: compare.py SOURCE.pgn [BASE_URL] [--ids-from=N]"""
import sys, io, json, urllib.request, urllib.parse, collections
import chess, chess.pgn

src = sys.argv[1]
base = sys.argv[2] if len(sys.argv) > 2 and not sys.argv[2].startswith('--') else 'http://127.0.0.1:3000'
min_id = int(next((a.split('=')[1] for a in sys.argv if a.startswith('--ids-from=')), '0'))

def get(path):
    return json.load(urllib.request.urlopen(base + path))

def read_all(text):
    f = io.StringIO(text); out = []
    while (g := chess.pgn.read_game(f)) is not None:
        out.append(g)
    return out

def key(g):
    h = g.headers
    return (h.get('White', '?'), h.get('Black', '?'), h.get('Event', '?'), h.get('Round', '?'), h.get('Date', '?'))

def summary(g):
    moves = [m.uci() for m in g.mainline_moves()]
    comments = []; nags = []; nvars = 0
    for node in g.mainline():
        if node.comment: comments.append(node.comment.strip())
        if node.nags: nags.append(sorted(node.nags))
    def count_vars(n):
        c = 0
        for i, v in enumerate(n.variations):
            if i > 0: c += 1
            c += count_vars(v)
        return c
    nvars = count_vars(g)
    return moves, comments, nags, nvars

try:
    text = open(src, encoding='utf-8').read()
except UnicodeDecodeError:
    text = open(src, encoding='latin-1').read()
source = read_all(text)
# fetch all ids
ids = []
off = 0
while True:
    r = get(f'/api/games?limit=500&offset={off}&sort=id&order=asc')
    ids += [g['id'] for g in r['games']]
    if len(r['games']) < 500: break
    off += 500
ids = [i for i in ids if i >= min_id]
db = {}
for i in ids:
    d = get(f'/api/games/{i}')
    g = chess.pgn.read_game(io.StringIO(d['pgn']))
    db.setdefault(key(g), []).append((i, g, d))
print('source games', len(source), 'db games', len(ids))
missing = []; diffs = collections.Counter(); examples = collections.defaultdict(list)
for s in source:
    k = key(s)
    if k not in db or not db[k]:
        missing.append(k); continue
    i, g, d = db[k].pop(0)
    sm, sc, sn, sv = summary(s); dm, dc, dn, dv = summary(g)
    if s.errors: continue  # illegal source game: compare prefix only
    for name, a, b in [('moves', sm, dm), ('comments', sc, dc), ('nags', sn, dn), ('variations', sv, dv)]:
        if a != b:
            diffs[name] += 1
            if len(examples[name]) < 3: examples[name].append((i, k[:3], str(a)[:200], str(b)[:200]))
    for t in ['White', 'Black', 'Event', 'Site', 'Date', 'Round', 'Result', 'WhiteElo', 'BlackElo', 'ECO', 'FEN']:
        sv_ = s.headers.get(t); dv_ = g.headers.get(t)
        if t in ('WhiteElo', 'BlackElo', 'ECO', 'FEN') and sv_ is None: continue
        if (sv_ or '?') != (dv_ or '?') and not (t == 'Round' and sv_ in (None, '?', '-')):
            diffs['hdr:' + t] += 1
            if len(examples['hdr:' + t]) < 3: examples['hdr:' + t].append((i, k[:3], sv_, dv_))
print('missing from db:', missing)
print('diff counts:', dict(diffs))
for n, ex in examples.items():
    print('--', n)
    for e in ex: print('   ', e)
