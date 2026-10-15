import { useSyncExternalStore } from "react";

const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  window.addEventListener("popstate", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("popstate", listener);
  };
}

export function navigate(path: string) {
  if (path === location.pathname) return;
  history.pushState(null, "", path);
  listeners.forEach((l) => l());
}

export function usePathname() {
  return useSyncExternalStore(subscribe, () => location.pathname);
}
