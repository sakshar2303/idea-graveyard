// Shared session state and a tiny pub/sub so the nav updates when auth changes.
export const state = { me: null, causes: [], aiEnabled: false };

const listeners = new Set();
export const onAuth = fn => listeners.add(fn);
export function setMe(me) {
  state.me = me;
  listeners.forEach(fn => fn(me));
}

// set by dialogs.js to avoid a circular import
let authPrompt = () => {};
export const setAuthPrompt = fn => { authPrompt = fn; };

// resolves true when a user is signed in, prompting if needed
export function requireAuth(reason) {
  if (state.me) return Promise.resolve(true);
  return authPrompt(reason);
}
