/** Typed client for the PGN Explorer HTTP API. */

export interface DbStats {
  games: number;
  players: number;
  events: number;
  positions: number;
  fileBytes: number;
  indexPlies: number;
  dataVersion: string;
}

export interface Info {
  version: string;
  stats: DbStats;
  engine: { available: boolean; path?: string };
  importing: boolean;
}

export interface GameRow {
  id: number;
  white: string;
  black: string;
  whiteElo: number | null;
  blackElo: number | null;
  event: string | null;
  site: string | null;
  date: string;
  round: string | null;
  result: string;
  eco: string | null;
  opening: string | null;
  plies: number;
  annotated: boolean;
  ply?: number;
}

export interface SearchResult {
  games: GameRow[];
  total: number;
  totalCapped: boolean;
  elapsedMs: number;
}

export interface GameQuery {
  player?: string;
  playerExact?: boolean;
  color?: 'any' | 'white' | 'black';
  opponent?: string;
  white?: string;
  black?: string;
  event?: string;
  site?: string;
  dateFrom?: string;
  dateTo?: string;
  result?: string;
  minElo?: number;
  maxElo?: number;
  eco?: string;
  opening?: string;
  minPlies?: number;
  maxPlies?: number;
  annotated?: boolean;
  fen?: string;
  sort?: string;
  order?: 'asc' | 'desc';
  offset?: number;
  limit?: number;
}

export interface MoveStats {
  uci: string;
  san: string;
  games: number;
  white: number;
  draws: number;
  black: number;
  avgElo: number | null;
  lastYear: number | null;
}

export interface ExplorerResult {
  fen: string;
  hash: string;
  total: { games: number; white: number; draws: number; black: number };
  ended: number;
  moves: MoveStats[];
  topGames: Array<GameRow & { ply: number }>;
  recentGames: Array<GameRow & { ply: number }>;
  opening: { eco: string; name: string } | null;
  indexPlies: number;
  elapsedMs: number;
  cached: boolean;
}

export interface ExplorerFilters {
  minElo?: number;
  maxElo?: number;
  yearFrom?: number;
  yearTo?: number;
}

export interface GameDetail {
  id: number;
  pgn: string;
  headers: Array<[string, string]>;
  plies: number;
}

export interface ImportProgress {
  phase: 'importing' | 'indexing' | 'done' | 'cancelled';
  file: string;
  bytesRead: number;
  totalBytes: number;
  imported: number;
  duplicates: number;
  errors: number;
  warnings: number;
  elapsedMs: number;
  gamesPerSecond: number;
  errorSamples: string[];
}

export interface Job {
  id: string;
  name: string;
  status: 'queued' | 'running' | 'done' | 'failed' | 'cancelled';
  progress: ImportProgress | null;
  error?: string;
  createdAt: number;
  finishedAt?: number;
}

export class ApiError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    let message = res.statusText;
    try {
      message = (await res.json()).error ?? message;
    } catch {
      /* not JSON */
    }
    throw new ApiError(message, res.status);
  }
  return res.json() as Promise<T>;
}

export function toQueryString(params: object): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '' || v === false) continue;
    sp.set(k, String(v));
  }
  return sp.toString();
}

export const api = {
  info: () => request<Info>('/api/info'),
  search: (q: GameQuery, signal?: AbortSignal) => request<SearchResult>(`/api/games?${toQueryString(q)}`, { signal }),
  game: (id: number) => request<GameDetail>(`/api/games/${id}`),
  createGame: (pgn: string) =>
    request<{ id: number }>('/api/games', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ pgn }),
    }),
  updateGame: (id: number, pgn: string) =>
    request<{ id: number }>(`/api/games/${id}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ pgn }),
    }),
  deleteGame: (id: number) => request<{ deleted: number }>(`/api/games/${id}`, { method: 'DELETE' }),
  explorer: (fen: string, f: ExplorerFilters, signal?: AbortSignal) =>
    request<ExplorerResult>(`/api/explorer?${toQueryString({ fen, ...f })}`, { signal }),
  suggest: (kind: 'players' | 'events' | 'sites', q: string, signal?: AbortSignal) =>
    request<string[]>(`/api/suggest/${kind}?${toQueryString({ q })}`, { signal }),
  jobs: () => request<Job[]>('/api/jobs'),
  job: (id: string) => request<Job>(`/api/jobs/${id}`),
  cancelJob: (id: string) => request<{ cancelled: boolean }>(`/api/jobs/${id}`, { method: 'DELETE' }),
  exportUrl: (q: GameQuery) => {
    const { offset: _o, limit: _l, sort: _s, order: _d, ...rest } = q;
    return `/api/export?${toQueryString(rest)}`;
  },
};

/**
 * Upload a PGN file for import, reporting upload progress (XHR is used because
 * fetch cannot report upload progress).
 */
export function uploadPgn(
  file: File,
  opts: { dedupe: boolean; stripAnnotations: boolean },
  onProgress: (loaded: number, total: number) => void,
): Promise<Job> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `/api/import?${toQueryString({ name: file.name, dedupe: opts.dedupe ? '1' : '0', stripAnnotations: opts.stripAnnotations ? '1' : '0' })}`);
    xhr.setRequestHeader('content-type', 'application/octet-stream');
    xhr.upload.onprogress = (e) => onProgress(e.loaded, e.total);
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve(JSON.parse(xhr.responseText));
      else {
        let msg = xhr.statusText;
        try {
          msg = JSON.parse(xhr.responseText).error ?? msg;
        } catch {
          /* ignore */
        }
        reject(new ApiError(msg, xhr.status));
      }
    };
    xhr.onerror = () => reject(new ApiError('Upload failed', 0));
    xhr.send(file);
  });
}
