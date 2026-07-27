import { useCallback, useEffect, useRef, useState } from 'react';

interface UseClickAndHoldOptions {
  onClick: () => void;
  onHold: () => void;
  threshold?: number;
}

interface UseClickAndHoldResult {
  isHolding: boolean;
  handlers: {
    onPointerDown: (e: React.PointerEvent) => void;
    onPointerUp: (e: React.PointerEvent) => void;
    onPointerLeave: () => void;
    onPointerCancel: () => void;
    onClick: (e: React.MouseEvent) => void;
  };
}

export function useClickAndHold({
  onClick,
  onHold,
  threshold = 500,
}: UseClickAndHoldOptions): UseClickAndHoldResult {
  const [isHolding, setIsHolding] = useState(false);
  const timerRef = useRef<number | null>(null);
  const holdTriggeredRef = useRef(false);
  const suppressNextClickRef = useRef(false);

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const cancelHold = useCallback(() => {
    clearTimer();
    setIsHolding(false);
  }, [clearTimer]);

  const onClickWrapper = useCallback((e: React.MouseEvent) => {
    if (suppressNextClickRef.current) {
      e.preventDefault();
      e.stopPropagation();
      suppressNextClickRef.current = false;
      return;
    }
    onClick();
  }, [onClick]);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    if (e.button !== 0) return;
    clearTimer();
    holdTriggeredRef.current = false;
    suppressNextClickRef.current = false;
    setIsHolding(true);
    timerRef.current = window.setTimeout(() => {
      holdTriggeredRef.current = true;
      setIsHolding(false);
      onHold();
    }, threshold);
  }, [clearTimer, onHold, threshold]);

  const onPointerUp = useCallback(
    (e: React.PointerEvent) => {
      if (e.button !== 0) return;
      clearTimer();
      setIsHolding(false);
      const target = e.target as Node;
      if (e.currentTarget.contains(target)) {
        // Suppress the synthetic click event that follows pointer-based
        // activation so onClick is not invoked twice for mouse/touch users.
        suppressNextClickRef.current = true;
        window.setTimeout(() => {
          suppressNextClickRef.current = false;
        }, 0);
        if (!holdTriggeredRef.current) {
          onClick();
        }
      }
    },
    [clearTimer, onClick]
  );

  useEffect(() => {
    return () => {
      clearTimer();
    };
  }, [clearTimer]);

  return {
    isHolding,
    handlers: {
      onPointerDown,
      onPointerUp,
      onPointerLeave: cancelHold,
      onPointerCancel: cancelHold,
      onClick: onClickWrapper,
    },
  };
}
