'use client';

import { useRef, useState, useCallback, type ReactNode } from 'react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SwipeableItemProps {
  children: ReactNode;
  onSwipeLeft?: () => void;
  onSwipeRight?: () => void;
  leftLabel?: string;
  rightLabel?: string;
  disabled?: boolean;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SWIPE_THRESHOLD = 80;
const MAX_SWIPE = 120;
const TRANSITION_DURATION = '250ms';

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function SwipeableItem({
  children,
  onSwipeLeft,
  onSwipeRight,
  leftLabel = 'Entrada',
  rightLabel = 'Salida',
  disabled = false,
}: SwipeableItemProps) {
  const contentRef = useRef<HTMLDivElement>(null);
  const startXRef = useRef(0);
  const startYRef = useRef(0);
  const currentXRef = useRef(0);
  const isSwipingRef = useRef(false);
  const directionLockedRef = useRef(false);
  const [offsetX, setOffsetX] = useState(0);
  const [transitioning, setTransitioning] = useState(false);

  const resetPosition = useCallback(() => {
    setTransitioning(true);
    setOffsetX(0);
    setTimeout(() => setTransitioning(false), 260);
  }, []);

  const handleTouchStart = useCallback(
    (e: React.TouchEvent) => {
      if (disabled) return;
      const touch = e.touches[0];
      startXRef.current = touch.clientX;
      startYRef.current = touch.clientY;
      currentXRef.current = 0;
      isSwipingRef.current = false;
      directionLockedRef.current = false;
      setTransitioning(false);
    },
    [disabled]
  );

  const handleTouchMove = useCallback(
    (e: React.TouchEvent) => {
      if (disabled) return;
      const touch = e.touches[0];
      const deltaX = touch.clientX - startXRef.current;
      const deltaY = touch.clientY - startYRef.current;

      // Lock direction on first significant movement
      if (!directionLockedRef.current) {
        if (Math.abs(deltaX) < 5 && Math.abs(deltaY) < 5) return;
        directionLockedRef.current = true;
        // If vertical scroll is dominant, bail out
        if (Math.abs(deltaY) > Math.abs(deltaX)) {
          isSwipingRef.current = false;
          return;
        }
        isSwipingRef.current = true;
      }

      if (!isSwipingRef.current) return;

      // Prevent vertical scrolling while swiping horizontally
      e.preventDefault();

      // Clamp to max swipe distance
      const clampedX = Math.max(-MAX_SWIPE, Math.min(MAX_SWIPE, deltaX));

      // Only allow right swipe if onSwipeRight exists, left if onSwipeLeft exists
      if (clampedX > 0 && !onSwipeRight) return;
      if (clampedX < 0 && !onSwipeLeft) return;

      currentXRef.current = clampedX;
      setOffsetX(clampedX);
    },
    [disabled, onSwipeLeft, onSwipeRight]
  );

  const handleTouchEnd = useCallback(() => {
    if (disabled || !isSwipingRef.current) return;

    const deltaX = currentXRef.current;

    if (deltaX > SWIPE_THRESHOLD && onSwipeRight) {
      onSwipeRight();
    } else if (deltaX < -SWIPE_THRESHOLD && onSwipeLeft) {
      onSwipeLeft();
    }

    resetPosition();
    isSwipingRef.current = false;
  }, [disabled, onSwipeLeft, onSwipeRight, resetPosition]);

  // Calculate action button opacity based on swipe progress
  const rightActionOpacity = Math.min(1, Math.max(0, offsetX / SWIPE_THRESHOLD));
  const leftActionOpacity = Math.min(1, Math.max(0, -offsetX / SWIPE_THRESHOLD));

  return (
    <div className="relative overflow-hidden rounded-xl" data-testid="swipeable-item">
      {/* Right swipe action (Entrada) - revealed behind, on the left side */}
      {onSwipeRight && (
        <div
          className="absolute inset-y-0 left-0 flex items-center justify-start pl-4 bg-emerald-600 dark:bg-emerald-700 rounded-xl"
          style={{
            width: Math.max(0, offsetX),
            opacity: rightActionOpacity,
          }}
          aria-hidden
        >
          <span className="text-sm font-semibold text-white whitespace-nowrap">
            {leftLabel}
          </span>
        </div>
      )}

      {/* Left swipe action (Salida) - revealed behind, on the right side */}
      {onSwipeLeft && (
        <div
          className="absolute inset-y-0 right-0 flex items-center justify-end pr-4 bg-red-600 dark:bg-red-700 rounded-xl"
          style={{
            width: Math.max(0, -offsetX),
            opacity: leftActionOpacity,
          }}
          aria-hidden
        >
          <span className="text-sm font-semibold text-white whitespace-nowrap">
            {rightLabel}
          </span>
        </div>
      )}

      {/* Swipeable content */}
      <div
        ref={contentRef}
        className="relative z-10"
        style={{
          transform: `translateX(${offsetX}px)`,
          transition: transitioning
            ? `transform ${TRANSITION_DURATION} cubic-bezier(0.25, 0.46, 0.45, 0.94)`
            : 'none',
          willChange: 'transform',
        }}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        {children}
      </div>
    </div>
  );
}
