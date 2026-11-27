import { useEffect, useRef, type RefObject } from 'react';

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'textarea:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

const activeTrapStack: symbol[] = [];

function isElementVisible(el: HTMLElement): boolean {
  if (el.hidden || el.closest('[hidden], [aria-hidden="true"]')) {
    return false;
  }
  if (typeof window !== 'undefined' && typeof window.getComputedStyle === 'function') {
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden') {
      return false;
    }
  }
  return true;
}

export function getFocusableElements(container: HTMLElement): HTMLElement[] {
  const candidates = Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
  return candidates.filter((el) => isElementVisible(el));
}

export interface UseFocusTrapOptions {
  readonly active: boolean;
  readonly onEscape?: () => void;
  readonly restoreFocus?: boolean;
  readonly initialFocusRef?: RefObject<HTMLElement | null>;
  readonly returnFocusRef?: RefObject<HTMLElement | null>;
}

/**
 * Traps Tab/Shift+Tab focus inside an active modal/dialog, handles Escape dismissal,
 * supports nested dialog stacking cleanly, and restores focus to the trigger on close.
 */
export function useFocusTrap(
  containerRef: RefObject<HTMLElement | null>,
  { active, onEscape, restoreFocus = true, initialFocusRef, returnFocusRef }: UseFocusTrapOptions,
): void {
  const onEscapeRef = useRef(onEscape);
  onEscapeRef.current = onEscape;

  const restoreFocusRef = useRef(restoreFocus);
  restoreFocusRef.current = restoreFocus;

  const initialFocusRefHolder = useRef(initialFocusRef);
  initialFocusRefHolder.current = initialFocusRef;

  const returnFocusRefHolder = useRef(returnFocusRef);
  returnFocusRefHolder.current = returnFocusRef;

  useEffect(() => {
    if (!active) {
      return;
    }

    const container = containerRef.current;
    if (!container) {
      return;
    }

    const trapId = Symbol('focus-trap');
    activeTrapStack.push(trapId);

    const doc = container.ownerDocument;
    const previousFocus = doc.activeElement instanceof HTMLElement ? doc.activeElement : null;

    const initialTarget = initialFocusRefHolder.current?.current;
    if (initialTarget && container.contains(initialTarget) && isElementVisible(initialTarget)) {
      initialTarget.focus({ preventScroll: true });
    } else if (!container.contains(doc.activeElement)) {
      const focusable = getFocusableElements(container);
      const first = focusable[0] ?? container;
      first.focus({ preventScroll: true });
    }

    function handleKeyDown(event: KeyboardEvent) {
      const topTrap = activeTrapStack[activeTrapStack.length - 1];
      if (topTrap !== trapId) {
        return;
      }

      const currentContainer = containerRef.current;
      if (!currentContainer) {
        return;
      }

      if (event.key === 'Escape') {
        if (onEscapeRef.current) {
          event.preventDefault();
          event.stopPropagation();
          onEscapeRef.current();
        }
        return;
      }

      if (event.key !== 'Tab') {
        return;
      }

      const focusable = getFocusableElements(currentContainer);
      if (focusable.length === 0) {
        event.preventDefault();
        currentContainer.focus({ preventScroll: true });
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) {
        return;
      }

      const activeEl = doc.activeElement;
      const isInside = activeEl instanceof HTMLElement && currentContainer.contains(activeEl);

      if (event.shiftKey) {
        if (!isInside || activeEl === first || activeEl === currentContainer) {
          event.preventDefault();
          last.focus({ preventScroll: true });
        }
      } else if (!isInside || activeEl === last) {
        event.preventDefault();
        first.focus({ preventScroll: true });
      }
    }

    doc.addEventListener('keydown', handleKeyDown, true);
    return () => {
      doc.removeEventListener('keydown', handleKeyDown, true);
      const idx = activeTrapStack.lastIndexOf(trapId);
      if (idx !== -1) {
        activeTrapStack.splice(idx, 1);
      }
      if (restoreFocusRef.current) {
        const target = returnFocusRefHolder.current?.current ?? previousFocus;
        if (target && target.isConnected) {
          target.focus({ preventScroll: true });
        }
      }
    };
  }, [active, containerRef]);
}
