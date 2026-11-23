// localStorage pode não existir ou lançar exceção (aba privada, dados bloqueados): tudo em try/catch.

export function load<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export function save(key: string, value: unknown): void {
  try {
    if (value == null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* sem persistência: a sessão vale só enquanto a aba estiver aberta */
  }
}
