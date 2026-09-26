import json, urllib.request, urllib.parse, sys
import os
BASE = sys.argv[1] if len(sys.argv) > 1 else os.environ.get('PGNX_URL', 'http://127.0.0.1:3000')
ORACLE_JSON = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'out', 'oracle.json')
O = [r for r in json.load(open(ORACLE_JSON)) if r['var'] == '']

def api(params):
    q = urllib.parse.urlencode({**params, 'limit': 1})
    r = json.load(urllib.request.urlopen(f'{BASE}/api/games?{q}'))
    return r['total'], r['elapsedMs'], r.get('totalCapped')

def elo(x):
    try: return int(x)
    except: return None
def ymd(d):
    p = d.replace('?', '0').split('.')
    try: return int(p[0]) * 10000 + int(p[1]) * 100 + int(p[2])
    except: return 0
def has(s, sub): return sub.lower() in s.lower()
def res_for(r, name):
    white = has(r['w'], name)
    if r['r'] == '1/2-1/2': return 'draw'
    if r['r'] == '1-0': return 'win' if white else 'loss'
    if r['r'] == '0-1': return 'loss' if white else 'win'
    return None
def eco_in(e, lo, hi=None):
    if not e: return False
    if hi is None: return e.upper().startswith(lo.upper())
    return lo <= e <= hi

cases = [
    ('player=Carlsen', {'player': 'Carlsen'}, lambda r: has(r['w'], 'Carlsen') or has(r['b'], 'Carlsen')),
    ('player=carlsen (lowercase)', {'player': 'carlsen'}, lambda r: has(r['w'], 'Carlsen') or has(r['b'], 'Carlsen')),
    ('player=Carlsen,M exact', {'player': 'Carlsen,M', 'playerExact': 'true'}, lambda r: r['w'].lower() == 'carlsen,m' or r['b'].lower() == 'carlsen,m'),
    ('white=Carlsen', {'white': 'Carlsen'}, lambda r: has(r['w'], 'Carlsen')),
    ('black=Carlsen', {'black': 'Carlsen'}, lambda r: has(r['b'], 'Carlsen')),
    ('player=Carlsen color=black', {'player': 'Carlsen', 'color': 'black'}, lambda r: has(r['b'], 'Carlsen')),
    ('player=Carlsen opponent=Nakamura', {'player': 'Carlsen', 'opponent': 'Nakamura'}, lambda r: (has(r['w'], 'Carlsen') and has(r['b'], 'Nakamura')) or (has(r['b'], 'Carlsen') and has(r['w'], 'Nakamura'))),
    ('player=Carlsen color=white opponent=Firouzja', {'player': 'Carlsen', 'color': 'white', 'opponent': 'Firouzja'}, lambda r: has(r['w'], 'Carlsen') and has(r['b'], 'Firouzja')),
    ('player=Carlsen opponent=Carlsen (self)', {'player': 'Carlsen', 'opponent': 'Carlsen'}, lambda r: False),
    ('opponent=Carlsen only', {'opponent': 'Carlsen'}, lambda r: has(r['w'], 'Carlsen') or has(r['b'], 'Carlsen')),
    ('player="Magnus Carlsen"', {'player': 'Magnus Carlsen'}, lambda r: has(r['w'], 'Magnus Carlsen') or has(r['b'], 'Magnus Carlsen')),
    ('event=Tata Steel', {'event': 'Tata Steel'}, lambda r: has(r['ev'], 'Tata Steel')),
    ('event=Olympiad', {'event': 'Olympiad'}, lambda r: has(r['ev'], 'Olympiad')),
    ('site=Wijk', {'site': 'Wijk'}, lambda r: has(r['site'], 'Wijk')),
    ('date 2023', {'dateFrom': '2023', 'dateTo': '2023'}, lambda r: 20230000 <= ymd(r['d']) <= 20231231 and not r['d'].startswith('?')),
    ('date 2019.06.01-2019.12.31', {'dateFrom': '2019.06.01', 'dateTo': '2019.12.31'}, lambda r: 20190601 <= ymd(r['d']) <= 20191231),
    ('dateFrom 2025', {'dateFrom': '2025'}, lambda r: ymd(r['d']) >= 20250000),
    ('minElo=2700', {'minElo': 2700}, lambda r: elo(r['we']) and elo(r['be']) and min(elo(r['we']), elo(r['be'])) >= 2700),
    ('maxElo=1500', {'maxElo': 1500}, lambda r: elo(r['we']) and elo(r['be']) and max(elo(r['we']), elo(r['be'])) <= 1500),
    ('minElo=2600 maxElo=2700', {'minElo': 2600, 'maxElo': 2700}, lambda r: elo(r['we']) and elo(r['be']) and min(elo(r['we']), elo(r['be'])) >= 2600 and max(elo(r['we']), elo(r['be'])) <= 2700),
    ('result=1-0', {'result': '1-0'}, lambda r: r['r'] == '1-0'),
    ('result=0-1', {'result': '0-1'}, lambda r: r['r'] == '0-1'),
    ('result=1/2-1/2', {'result': '1/2-1/2'}, lambda r: r['r'] == '1/2-1/2'),
    ('result=*', {'result': '*'}, lambda r: r['r'] == '*'),
    ('eco=B90', {'eco': 'B90'}, lambda r: eco_in(r['eco'], 'B90')),
    ('eco=B9', {'eco': 'B9'}, lambda r: eco_in(r['eco'], 'B9')),
    ('eco=B90-B99', {'eco': 'B90-B99'}, lambda r: eco_in(r['eco'], 'B90', 'B99')),
    ('eco=A00-E99', {'eco': 'A00-E99'}, lambda r: eco_in(r['eco'], 'A00', 'E99')),
    ('eco=C', {'eco': 'C'}, lambda r: eco_in(r['eco'], 'C')),
    ('minPlies=200', {'minPlies': 200}, lambda r: r['plies'] >= 200),
    ('maxPlies=10', {'maxPlies': 10}, lambda r: r['plies'] <= 10),
    ('Carlsen black 2019-2025 win', {'player': 'Carlsen', 'color': 'black', 'dateFrom': '2019', 'dateTo': '2025', 'result': 'win'}, lambda r: has(r['b'], 'Carlsen') and 20190000 <= ymd(r['d']) <= 20251231 and r['r'] == '0-1'),
    ('Carlsen black 2019-2025 loss', {'player': 'Carlsen', 'color': 'black', 'dateFrom': '2019', 'dateTo': '2025', 'result': 'loss'}, lambda r: has(r['b'], 'Carlsen') and 20190000 <= ymd(r['d']) <= 20251231 and r['r'] == '1-0'),
    ('Carlsen any 2019-2025 draw', {'player': 'Carlsen', 'dateFrom': '2019', 'dateTo': '2025', 'result': 'draw'}, lambda r: (has(r['w'], 'Carlsen') or has(r['b'], 'Carlsen')) and 20190000 <= ymd(r['d']) <= 20251231 and r['r'] == '1/2-1/2'),
    ('Carlsen white B90-B99 minElo2600', {'player': 'Carlsen', 'color': 'white', 'eco': 'B90-B99', 'minElo': 2600}, lambda r: has(r['w'], 'Carlsen') and eco_in(r['eco'], 'B90', 'B99') and elo(r['we']) and elo(r['be']) and min(elo(r['we']), elo(r['be'])) >= 2600),
    ('event=Olympiad 2022 result=0-1 minElo=2500', {'event': 'Olympiad', 'dateFrom': '2022', 'dateTo': '2022', 'result': '0-1', 'minElo': 2500}, lambda r: has(r['ev'], 'Olympiad') and 20220000 <= ymd(r['d']) <= 20221231 and r['r'] == '0-1' and elo(r['we']) and elo(r['be']) and min(elo(r['we']), elo(r['be'])) >= 2500),
]
print(f'{"query":48} {"app":>7} {"oracle":>7}  ms')
for name, params, pred in cases:
    try: got, ms, capped = api(params)
    except Exception as e: got, ms, capped = f'ERR {e}', 0, None
    exp = sum(1 for r in O if pred(r))
    flag = '' if got == exp else '   <-- MISMATCH'
    print(f'{name:48} {got:>7} {exp:>7}  {ms}{flag}')
