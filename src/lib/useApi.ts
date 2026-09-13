"use client";

import * as React from "react";

/**
 * Fetch from /api/*. The only way a component reads data — no component ever
 * touches Prisma (build-plan rule 2), because this API surface is the contract
 * Spring Boot reimplements at V1.
 *
 * Returns the three states every screen has to ship: loading, error, loaded.
 */
export type ApiState<T> = {
  data: T | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
};

export function useApi<T>(path: string | null): ApiState<T> {
  const [data, setData] = React.useState<T | null>(null);
  const [loading, setLoading] = React.useState(path !== null);
  const [error, setError] = React.useState<string | null>(null);
  const [nonce, setNonce] = React.useState(0);

  React.useEffect(() => {
    if (!path) {
      setData(null);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    fetch(path)
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) {
          throw new Error(body?.message ?? `Request failed (${response.status})`);
        }
        return body as T;
      })
      .then((body) => {
        if (cancelled) return;
        setData(body);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [path, nonce]);

  return {
    data,
    loading,
    error,
    reload: React.useCallback(() => setNonce((n) => n + 1), []),
  };
}
