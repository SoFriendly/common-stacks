import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { RefreshCw } from "lucide-react";
import { tap } from "./haptics";

type RefreshFn = () => void | Promise<void>;

interface Registry {
  register: (fn: RefreshFn) => () => void;
}

const Ctx = createContext<Registry | null>(null);

const THRESHOLD = 80;
const MAX_PULL = 140;
const ANCHOR_Y = 56; // resting offset while refreshing

export function usePullToRefresh(fn: RefreshFn) {
  const ctx = useContext(Ctx);
  useEffect(() => {
    if (!ctx) return;
    return ctx.register(fn);
  }, [ctx, fn]);
}

interface HostProps {
  scrollRef: RefObject<HTMLElement | null>;
  enabled: boolean;
  children: ReactNode;
}

/**
 * Wraps a scroll container's children and provides iOS/Android-style
 * pull-to-refresh: the content translates downward as the user pulls,
 * a spinner is revealed above it, and a release past the threshold
 * triggers the registered refresh handler.
 */
export function PullToRefreshHost({ scrollRef, enabled, children }: HostProps) {
  const handlerRef = useRef<RefreshFn | null>(null);
  const [offset, setOffset] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [animating, setAnimating] = useState(false);

  const register = useCallback((fn: RefreshFn) => {
    handlerRef.current = fn;
    return () => {
      if (handlerRef.current === fn) handlerRef.current = null;
    };
  }, []);
  const value = useMemo(() => ({ register }), [register]);

  useEffect(() => {
    if (!enabled) return;
    const el = scrollRef.current;
    if (!el) return;

    let startY = 0;
    let active = false;
    let pullPx = 0;
    let crossed = false;

    const damp = (delta: number) => {
      // Square-root easing keeps motion responsive at small distances
      // but slows dramatically as the user pulls further.
      return Math.min(MAX_PULL, Math.sqrt(Math.max(0, delta)) * 8);
    };

    const onStart = (e: TouchEvent) => {
      if (el.scrollTop > 0 || refreshing) return;
      startY = e.touches[0].clientY;
      active = true;
      pullPx = 0;
      crossed = false;
      setAnimating(false);
    };
    const onMove = (e: TouchEvent) => {
      if (!active) return;
      const delta = e.touches[0].clientY - startY;
      if (delta <= 0) {
        // user reversed past the start — drop the gesture
        active = false;
        if (pullPx > 0) {
          setAnimating(true);
          setOffset(0);
        }
        return;
      }
      pullPx = damp(delta);
      setOffset(pullPx);
      if (!crossed && pullPx >= THRESHOLD) {
        crossed = true;
        tap(10);
      } else if (crossed && pullPx < THRESHOLD) {
        crossed = false;
      }
    };
    const onEnd = () => {
      if (!active) return;
      active = false;
      if (pullPx >= THRESHOLD && handlerRef.current) {
        tap(15);
        setRefreshing(true);
        setAnimating(true);
        setOffset(ANCHOR_Y);
        Promise.resolve(handlerRef.current()).finally(() => {
          setAnimating(true);
          setRefreshing(false);
          setOffset(0);
        });
      } else {
        setAnimating(true);
        setOffset(0);
      }
    };

    el.addEventListener("touchstart", onStart, { passive: true });
    el.addEventListener("touchmove", onMove, { passive: true });
    el.addEventListener("touchend", onEnd);
    el.addEventListener("touchcancel", onEnd);
    return () => {
      el.removeEventListener("touchstart", onStart);
      el.removeEventListener("touchmove", onMove);
      el.removeEventListener("touchend", onEnd);
      el.removeEventListener("touchcancel", onEnd);
    };
  }, [enabled, scrollRef, refreshing]);

  const progress = Math.min(1, offset / THRESHOLD);

  return (
    <Ctx.Provider value={value}>
      <div className="relative">
        <div
          aria-hidden={!offset && !refreshing}
          className="pointer-events-none absolute inset-x-0 top-0 z-10 flex items-start justify-center overflow-hidden"
          style={{
            height: Math.max(offset, refreshing ? ANCHOR_Y : 0),
            opacity: refreshing ? 1 : progress,
            transition: animating ? "height 220ms ease-out, opacity 220ms ease-out" : "none",
          }}
        >
          <div className="mt-3 flex h-8 w-8 items-center justify-center rounded-full bg-paper text-ink-soft shadow ring-1 ring-shelf">
            <RefreshCw
              className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`}
              style={
                refreshing
                  ? undefined
                  : { transform: `rotate(${progress * 270}deg)` }
              }
            />
          </div>
        </div>
        <div
          style={{
            transform: `translate3d(0, ${offset}px, 0)`,
            transition: animating ? "transform 220ms ease-out" : "none",
          }}
          onTransitionEnd={() => setAnimating(false)}
        >
          {children}
        </div>
      </div>
    </Ctx.Provider>
  );
}
