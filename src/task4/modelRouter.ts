
export interface ModelResponse {
  status: number;
  body: unknown;
}

export type Provider = "primary" | "backup";

export type ModelCall = (
  model: string,
  payload: unknown,
  signal: AbortSignal,
  provider: Provider
) => Promise<ModelResponse>;

async function callWithTimeout(
  call: ModelCall,
  model: string,
  payload: unknown,
  timeoutMs: number,
  provider: Provider
): Promise<ModelResponse> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;

  try {
    return await Promise.race([
      call(model, payload, controller.signal, provider),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new Error("UPSTREAM_TIMEOUT"));
        }, timeoutMs);
      })
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function routeWithFallback(
  call: ModelCall,
  payload: unknown,
  primary: string,
  backup: string,
  timeoutMs = 3000
): Promise<{ model: string; response: ModelResponse }> {
  try {
    const response = await callWithTimeout(
      call, primary, payload, timeoutMs, "primary"
    );

    if (response.status !== 429) {
      if (response.status >= 500) {
        throw new Error("UPSTREAM_FAILURE");
      }

      return { model: primary, response };
    }
  } catch {
    // Retry using the configured backup provider.
  }

  try {
    const response = await callWithTimeout(
      call, backup, payload, timeoutMs, "backup"
    );

    if (response.status < 200 || response.status >= 300) {
      throw new Error("BACKUP_FAILURE");
    }

    return { model: backup, response };
  } catch {
    throw new Error("ALL_MODELS_UNAVAILABLE");
  }
}
