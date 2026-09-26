/**
 * Minimal hash router. Routes:
 *   #/analysis            analysis board (optionally ?fen=...)
 *   #/game/123?ply=10     game from the database
 *   #/database?...        database browser with filters
 */
import { useSyncExternalStore } from 'react';

export interface Route {
  view: 'analysis' | 'database';
  gameId?: number;
  params: URLSearchParams;
}

export function parseHash(hash: string): Route {
  const h = hash.replace(/^#\/?/, '');
  const [path, query = ''] = h.split('?');
  const params = new URLSearchParams(query);
  const parts = path.split('/').filter(Boolean);
  if (parts[0] === 'database') return { view: 'database', params };
  if (parts[0] === 'game' && parts[1] && /^\d+$/.test(parts[1])) return { view: 'analysis', gameId: +parts[1], params };
  return { view: 'analysis', params };
}

function subscribe(cb: () => void) {
  window.addEventListener('hashchange', cb);
  return () => window.removeEventListener('hashchange', cb);
}

export function useHash(): string {
  return useSyncExternalStore(subscribe, () => location.hash);
}

export function navigate(hash: string, replace = false) {
  const target = hash.startsWith('#') ? hash : `#${hash}`;
  if (target === location.hash) return;
  if (replace) {
    history.replaceState(null, '', target);
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  } else {
    location.hash = target;
  }
}
