const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'textarea:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

const dialogStack = [];
let keydownBound = false;

function toElement(target) {
  if (!target) return null;
  if (typeof target === 'string') return document.querySelector(target);
  return target;
}

function isHiddenByClass(el) {
  return !!el?.classList?.contains('hidden');
}

function isFocusableVisible(el) {
  if (!el || el.disabled || el.getAttribute('aria-hidden') === 'true') return false;
  if (isHiddenByClass(el)) return false;
  if (typeof window === 'undefined' || !window.getComputedStyle) return true;
  const style = window.getComputedStyle(el);
  if (style.visibility === 'hidden' || style.display === 'none') return false;
  return true;
}

export function getFocusableElements(root) {
  if (!root?.querySelectorAll) return [];
  return [...root.querySelectorAll(FOCUSABLE_SELECTOR)].filter(isFocusableVisible);
}

function ensureDialogKeydownListener() {
  if (keydownBound || typeof document === 'undefined') return;
  document.addEventListener('keydown', handleDialogKeydown);
  keydownBound = true;
}

function focusDialog(overlay, focusSelector) {
  const preferred = focusSelector ? overlay.querySelector(focusSelector) : null;
  const focusables = getFocusableElements(overlay);
  const target = preferred && isFocusableVisible(preferred) ? preferred : focusables[0] || overlay;
  if (!target) return;
  if (target === overlay && !overlay.hasAttribute('tabindex')) overlay.setAttribute('tabindex', '-1');
  try { target.focus({ preventScroll: true }); } catch { target.focus?.(); }
}

function scheduleFocus(callback) {
  if (typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(callback);
    return;
  }
  setTimeout(callback, 0);
}

function getTopVisibleDialogEntry() {
  for (let i = dialogStack.length - 1; i >= 0; i -= 1) {
    const entry = dialogStack[i];
    if (entry?.overlay && !isHiddenByClass(entry.overlay)) return entry;
  }
  return null;
}

export function openDialog(overlayTarget, options = {}) {
  const overlay = toElement(overlayTarget);
  if (!overlay) return;
  const normalized = typeof options === 'string' ? { focusSelector: options } : options;
  let entry = dialogStack.find((item) => item.overlay === overlay);
  if (!entry) {
    entry = {
      overlay,
      restoreFocus: toElement(normalized.restoreFocus) || document.activeElement,
    };
    dialogStack.push(entry);
  } else if (normalized.restoreFocus) {
    entry.restoreFocus = toElement(normalized.restoreFocus);
  }
  overlay.classList.remove('hidden');
  overlay.removeAttribute('aria-hidden');
  ensureDialogKeydownListener();
  scheduleFocus(() => focusDialog(overlay, normalized.focusSelector));
}

export function closeDialog(overlayTarget, options = {}) {
  const overlay = toElement(overlayTarget);
  if (!overlay) return;
  const index = dialogStack.findIndex((item) => item.overlay === overlay);
  const entry = index >= 0 ? dialogStack[index] : null;
  if (index >= 0) dialogStack.splice(index, 1);
  overlay.classList.add('hidden');
  overlay.setAttribute('aria-hidden', 'true');
  if (options.restoreFocus === false) return;
  const restoreTarget = toElement(options.restoreFocus) || entry?.restoreFocus;
  if (
    restoreTarget &&
    restoreTarget !== overlay &&
    document.contains(restoreTarget) &&
    isFocusableVisible(restoreTarget)
  ) {
    try { restoreTarget.focus({ preventScroll: true }); } catch { restoreTarget.focus?.(); }
  }
}

export function closeTopDialog() {
  const entry = getTopVisibleDialogEntry();
  if (entry) closeDialog(entry.overlay);
}

export function handleDialogKeydown(event) {
  const entry = getTopVisibleDialogEntry();
  if (!entry) return;
  const overlay = entry.overlay;
  if (event.key === 'Escape') {
    event.preventDefault();
    closeDialog(overlay);
    return;
  }
  if (event.key !== 'Tab') return;

  const focusables = getFocusableElements(overlay);
  if (!focusables.length) {
    event.preventDefault();
    focusDialog(overlay);
    return;
  }
  const first = focusables[0];
  const last = focusables[focusables.length - 1];
  const active = document.activeElement;
  if (!overlay.contains(active)) {
    event.preventDefault();
    first.focus();
    return;
  }
  if (event.shiftKey && active === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && active === last) {
    event.preventDefault();
    first.focus();
  }
}
