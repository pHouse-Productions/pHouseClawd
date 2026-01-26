const AUTH_KEY = "vito_dash_auth";

export function getStoredPassword(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(AUTH_KEY);
}

export function setStoredPassword(password: string): void {
  localStorage.setItem(AUTH_KEY, password);
}

export function clearStoredPassword(): void {
  localStorage.removeItem(AUTH_KEY);
}

export async function authFetch(
  url: string,
  options: RequestInit = {}
): Promise<Response> {
  const password = getStoredPassword();
  const headers = new Headers(options.headers);

  if (password) {
    headers.set("X-Dashboard-Auth", password);
  }

  return fetch(url, {
    ...options,
    headers,
  });
}
