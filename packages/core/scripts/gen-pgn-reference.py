"""Reference data for the PGN fixtures, produced by python-chess."""
import glob
import json
import os

import chess.pgn

out = {}
for path in sorted(glob.glob(os.path.join(os.path.dirname(__file__), '../test/fixtures/*.pgn'))):
    games = []
    with open(path, encoding='utf-8-sig') as f:
        while True:
            g = chess.pgn.read_game(f)
            if g is None:
                break
            nodes = 0
            stack = [g]
            while stack:
                n = stack.pop()
                nodes += len(n.variations)
                stack.extend(n.variations)
            games.append({
                'headers': dict(g.headers),
                'mainline': [m.uci() for m in g.mainline_moves()],
                'nodes': nodes,
                'finalFen': g.end().board().fen(),
                'errors': len(g.errors),
            })
    out[os.path.basename(path)] = games
print(json.dumps(out, indent=1))
