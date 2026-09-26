import { create } from 'zustand';

interface Toast {
  id: number;
  kind: 'info' | 'error' | 'success';
  text: string;
}

const useToasts = create<{ toasts: Toast[] }>(() => ({ toasts: [] }));
let nextId = 1;

export function toast(text: string, kind: Toast['kind'] = 'info', ms = 3500) {
  const id = nextId++;
  useToasts.setState((s) => ({ toasts: [...s.toasts, { id, kind, text }] }));
  setTimeout(() => useToasts.setState((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), ms);
}

export function toastError(e: unknown) {
  toast(e instanceof Error ? e.message : String(e), 'error', 6000);
}

export function Toasts() {
  const toasts = useToasts((s) => s.toasts);
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`}>
          {t.text}
        </div>
      ))}
    </div>
  );
}
