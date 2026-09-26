import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export function tempDir(): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'pgnx-test-'));
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

export function writeTemp(dir: string, name: string, content: string): string {
  const p = join(dir, name);
  writeFileSync(p, content);
  return p;
}

/** A small hand-written database with known properties. */
export const SAMPLE_PGN = `
[Event "Test Open"]
[Site "Berlin"]
[Date "2020.05.01"]
[Round "1"]
[White "Carlsen, Magnus"]
[Black "Caruana, Fabiano"]
[Result "1-0"]
[WhiteElo "2850"]
[BlackElo "2820"]

1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Ba4 Nf6 5. O-O Be7 1-0

[Event "Test Open"]
[Site "Berlin"]
[Date "2020.05.02"]
[Round "2"]
[White "Caruana, Fabiano"]
[Black "Carlsen, Magnus"]
[Result "1/2-1/2"]
[WhiteElo "2820"]
[BlackElo "2850"]

1. e4 c5 2. Nf3 d6 3. d4 cxd4 4. Nxd4 Nf6 5. Nc3 a6 {Najdorf} 6. Be3 (6. Bg5 e6) 6... e5 1/2-1/2

[Event "Club Championship"]
[Site "London"]
[Date "2019.??.??"]
[Round "3"]
[White "Doe, John"]
[Black "Carlsen, Magnus"]
[Result "0-1"]
[WhiteElo "2100"]

1. d4 Nf6 2. c4 e6 3. Nc3 Bb4 0-1

[Event "Club Championship"]
[Site "London"]
[Date "2019.03.10"]
[Round "4"]
[White "Doe, John"]
[Black "Roe, Jane"]
[Result "*"]

1. e4 e5 2. Nf3 Nc6 3. Bc4 *

[Event "Setup"]
[FEN "4k3/8/8/8/8/8/4P3/4K3 w - - 0 1"]
[SetUp "1"]
[White "Endgame, Ed"]
[Black "Study, Sue"]
[Result "1-0"]

1. e4 Kd7 2. e5 1-0

[Event "Broken"]
[White "Bad, Bob"]
[Black "Worse, Will"]
[Result "0-1"]

1. e4 e5 2. Ke3 0-1

[Event "Variant"]
[Variant "Atomic"]
[White "X"]
[Black "Y"]

1. e4 *
`;
