"""Regenerate the derived fixtures (needs python-chess and qa/data/twic from fetch_twic.sh).

  pip install chess
  python qa/oracle/make_fixtures.py

Writes:
  qa/out/phase2.pgn      first 800 games of TWIC 1502 + fixtures/nasty.pgn (823 games)
  qa/fixtures/long.pgn   a random legal 700-ply game (seed 7)
  qa/fixtures/latin1.pgn a Latin-1 encoded game with accented names and comment
"""
import os, random, chess, chess.pgn

HERE = os.path.dirname(os.path.abspath(__file__))
QA = os.path.join(HERE, '..')
os.makedirs(os.path.join(QA, 'out'), exist_ok=True)

src = open(os.path.join(QA, 'data', 'twic', 'twic1502.pgn'), encoding='latin-1').read()
parts = src.split('\n[Event ')
games = [parts[0]] + ['[Event ' + p for p in parts[1:800]]
nasty = open(os.path.join(QA, 'fixtures', 'nasty.pgn'), encoding='utf-8').read()
with open(os.path.join(QA, 'out', 'phase2.pgn'), 'w', encoding='utf-8', newline='\n') as f:
    f.write('\n'.join(g.strip() + '\n' for g in games) + '\n' + nasty)

random.seed(7)
while True:
    b = chess.Board(); g = chess.pgn.Game(); n = g
    while not b.is_game_over() and b.ply() < 700:
        ms = list(b.legal_moves); quiet = [m for m in ms if not b.is_capture(m)] or ms
        m = random.choice(quiet if random.random() < 0.97 else ms); n = n.add_variation(m); b.push(m)
    if b.ply() >= 600: break
g.headers.update(Event='Very long game', White='Long, W', Black='Long, B', Date='2024.02.01', Result='*')
open(os.path.join(QA, 'fixtures', 'long.pgn'), 'w').write(str(g) + '\n')

lat = ('[Event "Latin-1 test \xe9t\xe9"]\n[Site "Z\xfcrich"]\n[Date "2024.03.01"]\n[Round "1"]\n'
       '[White "M\xfcller, J\xfcrgen"]\n[Black "Lars\xe9n, Bj\xf6rn"]\n[Result "1-0"]\n\n'
       '1. e4 {Tr\xe8s bien} e5 2. Qh5 Nc6 3. Bc4 Nf6 4. Qxf7# 1-0\n\n')
open(os.path.join(QA, 'fixtures', 'latin1.pgn'), 'wb').write(lat.encode('latin-1'))
print('done')
