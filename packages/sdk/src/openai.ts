import type { ModelProvider, ThinkRequest, ThinkResult } from "./model.js";

export interface OpenAIProviderOptions {
  /** Defaults to `OPENAI_API_KEY`. */
  apiKey?: string;
  /** Defaults to `gpt-5-mini`. */
  model?: string;
  /** Reasoning depth for reasoning models (gpt-5*, o*). Ignored for others. Defaults to `low`. */
  reasoningEffort?: "minimal" | "low" | "medium" | "high";
  /** Defaults to `https://api.openai.com/v1`. Any Chat Completions compatible endpoint works. */
  baseUrl?: string;
  timeoutMs?: number;
}

/**
 * {@link ModelProvider} backed by the OpenAI Chat Completions API.
 * No extra dependency: it talks HTTP with `fetch`.
 *
 * ```ts
 * import { OpenAIProvider } from "@aiagentzoo/sdk/openai";
 * const model = new OpenAIProvider({ model: "gpt-5-mini" });
 * ```
 */
export class OpenAIProvider implements ModelProvider {
  readonly id: string;
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly reasoningEffort: NonNullable<OpenAIProviderOptions["reasoningEffort"]>;
  private readonly timeoutMs: number;

  constructor(options: OpenAIProviderOptions = {}) {
    const apiKey = options.apiKey ?? process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error("OpenAIProvider needs an API key (OPENAI_API_KEY)");
    this.apiKey = apiKey;
    this.id = options.model ?? "gpt-5-mini";
    this.baseUrl = (options.baseUrl ?? "https://api.openai.com/v1").replace(/\/$/, "");
    this.reasoningEffort = options.reasoningEffort ?? "low";
    this.timeoutMs = options.timeoutMs ?? 120_000;
  }

  async think(request: ThinkRequest): Promise<ThinkResult> {
    const reasoning = /^(gpt-5|o\d)/.test(this.id);
    // The enclosure has already fenced untrusted data into system and prompt.
    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify({
        model: this.id,
        messages: [
          { role: "system", content: request.system },
          { role: "user", content: request.prompt },
        ],
        // Reasoning models spend part of the allowance thinking, so give them headroom.
        max_completion_tokens: (request.maxTokens ?? 4000) * (reasoning ? 4 : 1),
        ...(reasoning ? { reasoning_effort: this.reasoningEffort } : {}),
      }),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    const body = (await res.json().catch(() => ({}))) as {
      choices?: Array<{ message?: { content?: string | null; refusal?: string | null } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
      error?: { message?: string };
    };
    if (!res.ok) throw new Error(`OpenAI ${res.status}: ${body.error?.message ?? "request failed"}`);
    const message = body.choices?.[0]?.message;
    if (message?.refusal) throw new Error("model declined the request");
    return {
      text: (message?.content ?? "").trim(),
      inputTokens: body.usage?.prompt_tokens ?? 0,
      outputTokens: body.usage?.completion_tokens ?? 0,
    };
  }
}
