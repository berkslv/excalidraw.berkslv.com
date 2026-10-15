const KEY = "deviceName";

function guessDeviceName() {
  const ua = navigator.userAgent;
  const os = /Windows/.test(ua)
    ? "Windows"
    : /iPhone|iPad/.test(ua)
      ? "iOS"
      : /Mac OS X/.test(ua)
        ? "Mac"
        : /Android/.test(ua)
          ? "Android"
          : /Linux/.test(ua)
            ? "Linux"
            : "Unknown OS";
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /Firefox\//.test(ua)
      ? "Firefox"
      : /Chrome\//.test(ua)
        ? "Chrome"
        : /Safari\//.test(ua)
          ? "Safari"
          : "Browser";
  return `${os} · ${browser}`;
}

/** The name other devices see while this one holds a drawing's edit lock. */
export function getDeviceName(): string {
  try {
    return localStorage.getItem(KEY) || guessDeviceName();
  } catch {
    return guessDeviceName();
  }
}

export function setDeviceName(name: string) {
  try {
    if (name.trim()) localStorage.setItem(KEY, name.trim());
    else localStorage.removeItem(KEY);
  } catch {
    // Storage unavailable (private mode): fall back to the guessed name.
  }
}
