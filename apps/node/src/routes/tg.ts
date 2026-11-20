import type { IncomingMessage, ServerResponse } from "node:http";
import { type GuardianSession, verifyGuardian } from "../guardian.ts";
import { linkCode, setWatch, verifyInitData } from "../telegram.ts";
import { balanceOf, HOLDER_MIN, isHolder, TOKEN_MINT } from "../holders.ts";
import { SOLANA_ADDRESS, readJson, json } from "./http.ts";
import type { RouteContext } from "./context.ts";

/** Telegram links and watches, and holder balances. */
export async function tgRoutes(ctx: RouteContext, req: IncomingMessage, res: ServerResponse, url: URL, path: string): Promise<boolean> {
  const { enclosure, telegram } = ctx;
  if (req.method === "POST" && path === "/v1/tg/link") {
    if (!process.env.TELEGRAM_BOT_TOKEN) return json(res, 404, { error: "no telegram bot on this node" });
    const body = (await readJson(req).catch(() => null)) as { guardian?: GuardianSession } | null;
    const check = verifyGuardian(body?.guardian as GuardianSession);
    if (!check.ok) return json(res, 401, { error: "sign in with your wallet first" });
    return json(res, 200, { code: await linkCode(enclosure.store, check.address), holder: await isHolder(check.address) });
  }
  if (req.method === "POST" && path === "/v1/tg/watch") {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token || !telegram) return json(res, 404, { error: "no telegram bot on this node" });
    const body = (await readJson(req).catch(() => null)) as { initData?: string; mint?: string } | null;
    const user = verifyInitData(String(body?.initData ?? ""), token);
    if (user === null) return json(res, 401, { error: "open this from the Telegram bot" });
    if (typeof body?.mint !== "string" || !SOLANA_ADDRESS.test(body.mint)) return json(res, 400, { error: "not a Solana token address" });
    // In a private chat with the bot the chat id is the user id, so alerts land there.
    const result = await setWatch(enclosure.store, user, body.mint, true);
    return result.ok ? json(res, 200, { ok: true }) : json(res, 409, { error: result.reason });
  }
  const holderOf = /^\/v1\/holder\/([1-9A-HJ-NP-Za-km-z]{32,44})$/.exec(path);
  if (req.method === "GET" && holderOf) {
    const balance = await balanceOf(holderOf[1]!);
    return json(res, 200, { wallet: holderOf[1], balance, min: HOLDER_MIN, holder: (balance ?? 0) >= HOLDER_MIN, mint: TOKEN_MINT });
  }
  return false;
}
