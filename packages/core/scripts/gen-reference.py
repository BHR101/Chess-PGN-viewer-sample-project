"""Generate reference data with python-chess for differential tests.

Plays random games (biased towards captures, checks and promotions to hit
edge cases) and records SAN, UCI, FEN and Polyglot hash for every ply.

    pip install chess && python3 scripts/gen-reference.py > test/fixtures/reference-games.json
"""
import json
import random

import chess
import chess.polyglot

random.seed(20240601)
START_FENS = [
    chess.STARTING_FEN,
    "r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1",
    "8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1",
    "r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1",
    "rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8",
    "4k3/1P6/8/8/8/8/6p1/4K3 w - - 0 1",
    "r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1",
    "8/8/8/2k5/2pP4/8/B7/4K3 b - d3 0 3",
]


def pick(board):
    moves = list(board.legal_moves)
    weighted = []
    for m in moves:
        w = 1
        if board.is_capture(m):
            w += 3
        if m.promotion:
            w += 5
        if board.is_castling(m) or board.is_en_passant(m):
            w += 8
        if board.gives_check(m):
            w += 2
        weighted.append(w)
    return random.choices(moves, weights=weighted)[0]


games = []
for i in range(400):
    fen = START_FENS[i % len(START_FENS)]
    board = chess.Board(fen)
    plies = []
    for _ in range(random.randint(20, 160)):
        if board.is_game_over():
            break
        m = pick(board)
        san = board.san(m)
        board.push(m)
        plies.append([san, m.uci(), board.fen(), "%016x" % chess.polyglot.zobrist_hash(board)])
    games.append({"fen": fen, "hash": "%016x" % chess.polyglot.zobrist_hash(chess.Board(fen)), "plies": plies,
                  "checkmate": board.is_checkmate(), "stalemate": board.is_stalemate(),
                  "insufficient": board.is_insufficient_material(),
                  "legal": sorted(m.uci() for m in board.legal_moves)})
print(json.dumps(games, separators=(",", ":")))
