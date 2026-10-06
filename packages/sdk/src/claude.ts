import Anthropic from "@anthropic-ai/sdk";
import type { ModelProvider, ThinkRequest, ThinkResult } from "./model.js";

export interface ClaudeProviderOptions {
  /** Defaults to the `ANTHROPIC_API_KEY` / `ant auth` credentials the SDK resolves. */
  client?: Anthropic;
  /** Defaults to `claude-opus-5-5`. */
  model?: string;
  /** Thinking depth. Defaults to `low`: most zoo steps are short and frequent. */
  effort?: "low" | "medium" | "high" | "xhigh" | "max";
}

/**
 * {@link ModelProvider} backed by Claude. Install `@anthropic-ai/sdk`
 * alongside this package to use it.
 *
 * ```ts
 * import { ClaudeProvider } from "@aiagentzoo/sdk/claude";
 * const model = new ClaudeProvider({ effort: "medium" });
 * ```
 */
export class ClaudeProvider implements ModelProvider {
  readonly id: string;
  private readonly client: Anthropic;
  private readonly effort: NonNullable<ClaudeProviderOptions["effort"]>;

  constructor(options: ClaudeProviderOptions = {}) {
    this.client = options.client ?? new Anthropic();
    this.id = options.model ?? "claude-opus-5-5";
    this.effort = options.effort ?? "low";
  }

  async think(request: ThinkRequest): Promise<ThinkResult> {
    // Server-side fallback: if a safety classifier declines, the API retries
    // on a fallback model inside the same call instead of failing the cycle.
    const response = await this.client.beta.messages.create({
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      model: this.id,
      max_tokens: request.maxTokens ?? 4000,
      system: [{ type: "text", text: request.system, cache_control: { type: "ephemeral" } }],
      output_config: { effort: this.effort },
      messages: [{ role: "user", content: request.prompt }],
    });

    if (response.stop_reason === "refusal") {
      throw new Error("model declined the request");
    }

    const text = response.content
      .map((block) => (block.type === "text" ? block.text : ""))
      .join("")
      .trim();
    return {
      text,
      inputTokens:
        response.usage.input_tokens +
        (response.usage.cache_creation_input_tokens ?? 0) +
        (response.usage.cache_read_input_tokens ?? 0),
      outputTokens: response.usage.output_tokens,
    };
  }
}
