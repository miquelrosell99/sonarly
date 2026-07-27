import { useCallback, useRef, useState } from 'react';

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

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const onPointerDown = useCallback(() => {
    holdTriggeredRef.current = false;
    setIsHolding(true);
    timerRef.current = window.setTimeout(() => {
      holdTriggeredRef.current = true;
      setIsHolding(false);
      onHold();
    }, threshold);
  }, [onHold, threshold]);

  const onPointerUp = useCallback(
    (e: React.PointerEvent) => {
      clearTimer();
      setIsHolding(false);
      const target = e.target as Node;
      if (!holdTriggeredRef.current && e.currentTarget.contains(target)) {
        onClick();
      }
    },
    [clearTimer, onClick]
  );

  const onPointerLeave = useCallback(() => {
    clearTimer();
    setIsHolding(false);
  }, [clearTimer]);

  const onPointerCancel = useCallback(() => {
    clearTimer();
    setIsHolding(false);
  }, [clearTimer]);

  return {
    isHolding,
    handlers: { onPointerDown, onPointerUp, onPointerLeave, onPointerCancel },
  };
}
