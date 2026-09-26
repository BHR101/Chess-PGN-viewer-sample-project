"""Independent python-chess oracle over the TWIC files: header table + explorer stats for target positions."""
import chess, chess.pgn, glob, json, sys, os
from multiprocessing import Pool

TARGET_MOVES = {
    'start': [],
    'e4': ['e4'], 'e4 e5': ['e4', 'e5'], 'e4 c5': ['e4', 'c5'], 'd4 Nf6': ['d4', 'Nf6'],
    # transposition targets (defined by one move order; oracle counts any order)
    'QGD': ['d4', 'd5', 'c4', 'e6', 'Nc3', 'Nf6'],
    'Najdorf': ['e4', 'c5', 'Nf3', 'd6', 'd4', 'cxd4', 'Nxd4', 'Nf6', 'Nc3', 'a6'],
    'Nimzo': ['d4', 'Nf6', 'c4', 'e6', 'Nc3', 'Bb4'],
    'Catalan': ['d4', 'Nf6', 'c4', 'e6', 'g3', 'd5', 'Bg2'],
}
def key_of(moves):
    b = chess.Board()
    for m in moves: b.push_san(m)
    return b._transposition_key()
TARGETS = {n: key_of(m) for n, m in TARGET_MOVES.items()}
KEY2NAME = {v: k for k, v in TARGETS.items()}
INDEX_PLIES = 60
HERE = os.path.dirname(os.path.abspath(__file__))

def work(path):
    rows = []
    with open(path, encoding='latin-1') as f:
        while True:
            g = chess.pgn.read_game(f)
            if g is None: break
            h = g.headers
            variant = h.get('Variant', '')
            b = g.board()
            hits = {}
            ply = 0
            moves = []
            node = g
            ok = not g.errors
            while node.variations:
                nxt = node.variations[0]
                if ply <= INDEX_PLIES:
                    k = b._transposition_key()
                    n = KEY2NAME.get(k)
                    if n and n not in hits: hits[n] = b.san(nxt.move)
                b.push(nxt.move); ply += 1; moves.append(nxt.move.uci()); node = nxt
            if ply <= INDEX_PLIES:
                n = KEY2NAME.get(b._transposition_key())
                if n and n not in hits: hits[n] = None  # ended here
            rows.append({
                'w': h.get('White', '?'), 'b': h.get('Black', '?'), 'ev': h.get('Event', '?'), 'site': h.get('Site', '?'),
                'd': h.get('Date', '????.??.??'), 'rd': h.get('Round', '?'), 'r': h.get('Result', '*'),
                'we': h.get('WhiteElo'), 'be': h.get('BlackElo'), 'eco': h.get('ECO'), 'var': variant,
                'plies': ply, 'hits': hits, 'mv': ' '.join(moves[:12]), 'mvh': hash(' '.join(moves)), 'err': [str(e)[:60] for e in g.errors],
            })
    return rows

if __name__ == '__main__':
    files = sorted(glob.glob(os.path.join(HERE, '..', 'data', 'twic', '*.pgn')))
    with Pool(max(2, os.cpu_count() - 1)) as p:
        out = [r for rows in p.map(work, files) for r in rows]
    os.makedirs(os.path.join(HERE, '..', 'out'), exist_ok=True)
    json.dump(out, open(os.path.join(HERE, '..', 'out', 'oracle.json'), 'w'))
    print('games', len(out))
