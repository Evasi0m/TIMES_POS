// React access to the signed-in user's permissions (see ./permissions.js).
// Provided once by the App shell; any component can ask `useCan('key')`.
import { createContext, createElement, useContext } from 'react';
import { can as canKey, effectivePermissions } from './permissions.js';

const fallback = { role: 'visitor', perms: effectivePermissions('visitor', null), loaded: false };

export const PermCtx = createContext(fallback);

export function PermProvider({ value, children }) {
  return createElement(PermCtx.Provider, { value }, children);
}

/** { role, perms, loaded, can(key) } */
export function usePerms() {
  const v = useContext(PermCtx) || fallback;
  return { ...v, can: (keys) => canKey(v.perms, keys) };
}

/** True when the user has the key (or any of 'a|b'). */
export function useCan(keys) {
  const v = useContext(PermCtx) || fallback;
  return canKey(v.perms, keys);
}
