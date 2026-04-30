/**
 * Shared proof-of-work configuration constants.
 * Override these in one place to change PoW browser fingerprint fields
 * used by both proof-worker.js and openai-oauth-image.js.
 */

// ── proof-worker.js (generateProofToken) ────────────────────────────
/** Screen width used when seed length is even */
export const SCREEN_EVEN = 4010;
/** Screen width used when seed length is odd */
export const SCREEN_ODD = 3008;
/** Browser version field */
export const PROOF_VERSION = '5';
/** React listening key */
export const REACT_LISTENING_KEY = '_reactListening';
/** Alert function key */
export const ALERT_KEY = 'alert';
/** Default DPL value when none is provided */
export const DEFAULT_DPL = 'dpl=openai-images';

// ── openai-oauth-image.js (generateRequirementsToken) ──────────────
/** Core version identifier */
export const CORE_VERSION = 'core3008';
/** Product identifier for requirements */
export const REQUIREMENTS_PRODUCT = 'prod-openai-images';
/** Navigator webdriver key */
export const WEBDRIVER_KEY = 'navigator.webdriver';
/** Location key */
export const LOCATION_KEY = 'location';
/** Document body key */
export const DOCUMENT_BODY_KEY = 'document.body';
/** Challenge difficulty version number */
export const CHALLENGE_VERSION = 8;
