// The phone's stand-in for the browser's localStorage: expo-sqlite's key-value
// store, used through its synchronous calls so everything written against the
// web's Storage API (the local backend, the day cache, tracking) works as is.

import Storage from "expo-sqlite/kv-store";
import type { KeyValueStore } from "./localBackend";

// Never throws on read — a store that can't be opened reads as empty. Writes
// still throw, and the local backend reports them.
export const deviceStore: KeyValueStore = {
  getItem: (key) => {
    try {
      return Storage.getItemSync(key);
    } catch {
      return null;
    }
  },
  setItem: (key, value) => Storage.setItemSync(key, value),
  removeItem: (key) => {
    try {
      Storage.removeItemSync(key);
    } catch {
      // Nothing to remove from storage we can't reach
    }
  },
};
