export function createButton({
  className = '',
  text = '',
  title = '',
  ariaLabel = '',
  danger = false,
  onClick,
} = {}) {
  const button = document.createElement('button');
  button.type = 'button';
  if (className) button.className = className;
  if (danger && !button.classList.contains('danger')) button.classList.add('danger');
  if (text) button.textContent = text;
  if (title) button.title = title;
  if (ariaLabel || title || text) button.setAttribute('aria-label', ariaLabel || title || text);
  if (typeof onClick === 'function') button.onclick = onClick;
  return button;
}

export function createIconButton({
  className = '',
  title,
  ariaLabel,
  iconSvg,
  danger = false,
  onClick,
} = {}) {
  const button = createButton({ className, title, ariaLabel, danger, onClick });
  if (iconSvg) {
    button.innerHTML = iconSvg;
    button.querySelectorAll('svg').forEach((svg) => {
      svg.setAttribute('aria-hidden', 'true');
      svg.setAttribute('focusable', 'false');
    });
  }
  return button;
}

export function confirmAction(message) {
  return window.confirm(message);
}

export function notifyAction(message) {
  const text = String(message || '').trim();
  if (!text) return;
  const status = document.querySelector('#historyStatus') || document.querySelector('#generationHint');
  if (status) {
    status.textContent = text;
    status.classList?.remove?.('hidden');
  }
}
