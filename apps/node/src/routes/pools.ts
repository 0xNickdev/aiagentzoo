import type { IncomingMessage, ServerResponse } from "node:http";
import { join } from "node:path";
import { json } from "./http.ts";
import type { RouteContext } from "./context.ts";
import { PoolBook } from "../chain/pools.ts";

let book: PoolBook | null = null;

/** The pool reader, running on the node that reads the chain. ZOO_POOLS=off skips it. */
export function startPools(log: (m: string) => void = (m) => console.warn(m)): PoolBook | null {
  if (book || process.env.ZOO_POOLS === "off") return book;
  const dir = process.env.ZOO_DATA_DIR ?? join(process.cwd(), "data");
  book = new PoolBook(join(dir, "pools.json"), log);
  book.start();
  return book;
}
export const pools = (): PoolBook | null => book;

/** Top-volume PumpSwap pools with what the chain says about each: who opened it, what came back out, how much of the trading was a bag passed around. */
export async function poolRoutes(_ctx: RouteContext, req: IncomingMessage, res: ServerResponse, _url: URL, path: string): Promise<boolean> {
  if (req.method !== "GET" || path !== "/v1/pools") return false;
  if (!book) return json(res, 404, { error: "this node does not read pools; use the north node" });
  res.setHeader("cache-control", "public, max-age=60");
  return json(res, 200, book.view());
}
