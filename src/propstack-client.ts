export type { PropstackPaginatedResponse } from "./types/propstack.js";

const V1_BASE = "https://api.propstack.de/v1";

const MAX_RETRIES = 3;
const RETRY_BASE_MS = 1000;

export interface PropstackRequestOptions {
  params?: Record<string, string | number | boolean | string[] | number[] | undefined>;
  body?: unknown;
}

export class PropstackError extends Error {
  constructor(
    public readonly status: number,
    public readonly statusText: string,
    public readonly detail: string,
    public readonly path: string = "",
  ) {
    super(`Propstack API ${status} ${statusText}: ${detail}`);
    this.name = "PropstackError";
  }
}

export class PropstackClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(apiKey: string, baseUrl: string = V1_BASE) {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl;
  }

  async get<T>(path: string, opts?: PropstackRequestOptions): Promise<T> {
    return this.request<T>("GET", path, opts);
  }

  async post<T>(path: string, opts?: PropstackRequestOptions): Promise<T> {
    return this.request<T>("POST", path, opts);
  }

  async put<T>(path: string, opts?: PropstackRequestOptions): Promise<T> {
    return this.request<T>("PUT", path, opts);
  }

  async delete<T>(path: string, opts?: PropstackRequestOptions): Promise<T> {
    return this.request<T>("DELETE", path, opts);
  }

  private buildUrl(path: string, params?: PropstackRequestOptions["params"]): string {
    const url = new URL(`${this.baseUrl}${path}`);
    if (params) {
      for (const [key, value] of Object.entries(params)) {
        if (value === undefined) continue;
        if (Array.isArray(value)) {
          for (const item of value) {
            url.searchParams.append(`${key}[]`, String(item));
          }
        } else {
          url.searchParams.set(key, String(value));
        }
      }
    }
    return url.toString();
  }

  private async request<T>(
    method: string,
    path: string,
    opts?: PropstackRequestOptions,
  ): Promise<T> {
    const url = this.buildUrl(path, opts?.params);

    const headers: Record<string, string> = {
      "X-API-KEY": this.apiKey,
      "Accept": "application/json",
    };

    const init: RequestInit = { method, headers };

    if (opts?.body !== undefined && (method === "POST" || method === "PUT" || method === "PATCH")) {
      headers["Content-Type"] = "application/json";
      init.body = JSON.stringify(opts.body);
    }

    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      if (attempt > 0) {
        const delay = RETRY_BASE_MS * 2 ** (attempt - 1);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }

      let res: Response;
      try {
        res = await fetch(url, init);
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        continue;
      }

      if (res.status === 429 && attempt < MAX_RETRIES) {
        const retryAfter = res.headers.get("Retry-After");
        if (retryAfter) {
          await new Promise((resolve) => setTimeout(resolve, Number(retryAfter) * 1000));
        }
        continue;
      }

      if (!res.ok) {
        const body = await res.text();
        throw new PropstackError(res.status, res.statusText, body, path);
      }

      if (res.status === 204) {
        return undefined as T;
      }

      return (await res.json()) as T;
    }

    throw lastError ?? new Error(`Request to ${path} failed after ${MAX_RETRIES} retries`);
  }
}
