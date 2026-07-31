/* First-party lookup counter.
 *
 * WHY THIS EXISTS: the landing page and welcome screen used to read GoatCounter's
 * `event/fetch` tally, which undercounts badly for two reasons — ad blockers drop
 * gc.zgo.at outright, and GoatCounter dedups per visitor per day, so a hundred lookups
 * from one enthusiastic visitor read as one. It sat stuck around 22 even in the week the
 * site was posted on chess.com. This endpoint is same-origin (/api/lookups), so no
 * blocker touches it, and every lookup counts.
 *
 * WHY A NODE FUNCTION AND NOT AN EDGE FUNCTION: importing @netlify/blobs from an edge
 * function does not resolve in Netlify's Deno edge runtime, and a bundling error in ANY
 * edge function fails the whole "building site" stage — the deploy never publishes and
 * the site silently stays on the previous commit. That is what killed commit 452c6da.
 * Node functions bundle their npm deps normally, so Blobs belongs here.
 *
 * PRIVACY: the browser sends no username, no hash, no body at all — just a bare POST.
 * Nothing identifying leaves the device, so "your games never leave your browser" stays
 * literally true.
 */
import { getStore } from "@netlify/blobs";

/* Lookups counted before this endpoint existed. GoatCounter's event/fetch tally at
   cutover (2026-07-31). It's a floor, not a true total — the real figure is higher,
   since that's exactly the undercount this endpoint replaces. */
const BASE = 95;
const KEY = "lookups";

export default async (req) => {
  let stored = 0;
  try {
    const store = getStore("rookbook");

    if (req.method === "POST") {
      /* Read-modify-write, so two lookups landing in the same instant can cost one
         count. For a social-proof number that drifts by a hair under load, that is a
         fine trade against the complexity of a lock — and it can only ever undercount,
         never inflate, which is the direction an honest counter should err. */
      stored = Number(await store.get(KEY)) || 0;
      stored += 1;
      await store.set(KEY, String(stored));
    } else {
      stored = Number(await store.get(KEY)) || 0;
    }
  } catch (e) {
    /* Never let the counter break the page it decorates. A failed read just reports the
       floor; a failed write drops one count. Both are invisible to the visitor. */
    return Response.json(
      { count: BASE, degraded: true },
      { headers: { "cache-control": "no-store" } }
    );
  }

  return Response.json(
    { count: BASE + stored },
    { headers: { "cache-control": "no-store" } }
  );
};

export const config = { path: "/api/lookups" };
