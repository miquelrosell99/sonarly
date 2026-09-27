// Unsaved-changes save bar for settings-style pages. A shell (Settings,
// Admin panel) wraps its content in <SaveBarProvider> and renders <SaveBar>
// next to its page title; a page stages its edits locally and registers a
// controller with useSaveBar(). The bar appears only while a registered
// controller reports dirty, so pages without staged edits never show one.
//
// Robustness contract: onSave resolves on success and rejects on failure —
// the page keeps its draft alive on error (user input is never discarded),
// and Ctrl/Cmd+S saves while dirty.
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { Button } from './Button.js';

export interface SaveBarController {
  dirty: boolean;
  saving: boolean;
  onSave: () => void | Promise<void>;
  onDiscard: () => void;
}

interface SaveBarHostValue {
  controller: SaveBarController | null;
  register: (controller: SaveBarController | null) => void;
}

const SaveBarHostContext = createContext<SaveBarHostValue | null>(null);

export function SaveBarProvider({ children }: { children: ReactNode }) {
  const [controller, setController] = useState<SaveBarController | null>(null);
  const register = useCallback((next: SaveBarController | null) => {
    setController((prev) => (prev === next ? prev : next));
  }, []);
  const value = useMemo(() => ({ controller, register }), [controller, register]);
  return <SaveBarHostContext.Provider value={value}>{children}</SaveBarHostContext.Provider>;
}

/** The shell-side hook: returns the controller a page registered, if any. */
export function useSaveBarHost(): SaveBarController | null {
  return useContext(SaveBarHostContext)?.controller ?? null;
}

/**
 * The page-side hook: publishes the page's controller to the surrounding
 * shell and clears the registration on unmount. Re-fires only when the
 * controller identity changes, so callers must memoize it (useMemo over
 * dirty/saving/handlers) — the host context object intentionally tracks the
 * registered controller and must NOT be a dependency here.
 */
export function useSaveBar(controller: SaveBarController | null): void {
  const host = useContext(SaveBarHostContext);
  const hostRef = useRef(host);
  hostRef.current = host;
  const controllerRef = useRef(controller);
  controllerRef.current = controller;
  useEffect(() => {
    const h = hostRef.current;
    if (!h) return undefined;
    h.register(controllerRef.current);
    return () => h.register(null);
  }, [controller]);
}

export function SaveBar({ controller }: { controller: SaveBarController }) {
  const onSave = controller.onSave;

  useEffect(() => {
    if (!controller.dirty) return undefined;
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        void onSave();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [controller.dirty, onSave]);

  if (!controller.dirty) return null;

  return (
    <div className="flex items-center gap-2" role="group" aria-label="Unsaved changes">
      <span className="hidden text-xs text-muted sm:inline">Unsaved changes</span>
      <Button variant="ghost" onClick={controller.onDiscard} disabled={controller.saving}>
        Discard
      </Button>
      <Button onClick={() => void onSave()} loading={controller.saving}>
        Save changes
      </Button>
    </div>
  );
}
