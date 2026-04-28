export const $ = (selector, root = document) => root.querySelector(selector);

export function setText(selector, value) {
  const el = $(selector);
  if (el) el.textContent = value == null ? '' : String(value);
  return el;
}
