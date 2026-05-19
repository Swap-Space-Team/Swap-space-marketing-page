// js/current-user.js — Ola/Ezekiel session selector (no auth; honor system).

const LS_KEY = 'swapspace_current_user';
export const USERS = ['Ola', 'Ezekiel'];

let _current = null;

export function getCurrentUser() {
  if (_current) return _current;
  const stored = localStorage.getItem(LS_KEY);
  if (stored && USERS.includes(stored)) {
    _current = stored;
    return _current;
  }
  return null;
}

export function setCurrentUser(name) {
  if (!USERS.includes(name)) throw new Error(`Unknown user: ${name}`);
  _current = name;
  localStorage.setItem(LS_KEY, name);
  window.dispatchEvent(new CustomEvent('user:changed', { detail: name }));
  return _current;
}

export function needsPicker() {
  return getCurrentUser() === null;
}
