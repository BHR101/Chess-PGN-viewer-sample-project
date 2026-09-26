"""Compare /api/explorer against the python-chess oracle for target positions (and transposition-equivalent FENs)."""
import json, urllib.request, urllib.parse, collections, sys
import chess
import os
BASE = sys.argv[1] if len(sys.argv) > 1 else os.environ.get('PGNX_URL', 'http://127.0.0.1:3000')
ORACLE_JSON = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'out', 'oracle.json')
O = [r for r in json.load(open(ORACLE_JSON)) if r['var'] == '']
from oracle import TARGET_MOVES

ALT_ORDERS = {  # other move orders reaching the same position
    'QGD': ['c4', 'e6', 'Nc3', 'd5', 'd4', 'Nf6'],
    'Najdorf': ['Nf3', 'c5', 'e4', 'd6', 'd4', 'cxd4', 'Nxd4', 'Nf6', 'Nc3', 'a6'],
    'Nimzo': ['c4', 'e6', 'Nc3', 'Nf6', 'd4', 'Bb4'],
    'Catalan': ['Nf3', 'Nf6', 'c4', 'e6', 'g3', 'd5', 'd4', 'Bg2'][:7] and ['c4', 'e6', 'g3', 'Nf6', 'Bg2', 'd5', 'd4'],
}
def fen_of(moves):
    b = chess.Board()
    for m in moves: b.push_san(m)
    return b.fen()

def explorer(fen):
    return json.load(urllib.request.urlopen(f'{BASE}/api/explorer?' + urllib.parse.urlencode({'fen': fen})))

res_code = {'1-0': 'w', '0-1': 'b', '1/2-1/2': 'd'}
print(f'{"position":10} {"app games":>9} {"oracle":>7} {"W/D/B app":>20} {"W/D/B oracle":>20} {"ended":>9}  moves-diff')
for name, mv in TARGET_MOVES.items():
    hits = [(r['hits'][name], r['r']) for r in O if name in r['hits']]
    exp_total = len(hits)
    wdb = collections.Counter(res_code.get(res, '*') for _, res in hits)
    exp_moves = collections.Counter(m for m, _ in hits if m)
    exp_ended = sum(1 for m, _ in hits if m is None)
    for label, fen in [(name, fen_of(mv))] + ([(name + '(alt)', fen_of(ALT_ORDERS[name]))] if name in ALT_ORDERS else []):
        e = explorer(fen)
        got_moves = {m['san']: m['games'] for m in e['moves']}
        diff = {k: (got_moves.get(k, 0), exp_moves.get(k, 0)) for k in set(got_moves) | set(exp_moves) if got_moves.get(k, 0) != exp_moves.get(k, 0)}
        t = e['total']
        print(f'{label:10} {t["games"]:>9} {exp_total:>7} {str((t["white"], t["draws"], t["black"])):>20} {str((wdb["w"], wdb["d"], wdb["b"])):>20} {e["ended"]:>4}/{exp_ended:<4}  {dict(list(diff.items())[:6]) or "identical"}  [{e["elapsedMs"]}ms cached={e["cached"]}]')
        if name in ('start', 'e4', 'd4 Nf6'):
            print('            top moves:', ', '.join(f'{m["san"]} {m["games"]}' for m in e['moves'][:6]), '| opening:', e.get('opening'))
