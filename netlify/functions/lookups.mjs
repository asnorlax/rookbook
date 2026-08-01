/* First-party usage counters.
 *
 * WHY THIS EXISTS: everything here used to run through GoatCounter, which undercounts badly.
 * Ad blockers drop gc.zgo.at outright, and GoatCounter dedups per visitor per day, so a
 * hundred lookups from one enthusiastic visitor read as one — the lookup tally sat near 22
 * through the week the site was posted on chess.com. This endpoint is same-origin, so no
 * blocker touches it, and it dedups nothing.
 *
 * WHY A NODE FUNCTION AND NOT AN EDGE FUNCTION: importing @netlify/blobs from an edge
 * function does not resolve in Netlify's Deno edge runtime, and a bundling error in ANY edge
 * function fails the whole "building site" stage — the deploy never publishes and the site
 * silently stays on the previous commit. That is what killed commit 452c6da.
 *
 * PRIVACY: counters only. No username, no game data, no identifier of any kind is accepted or
 * stored — the POST body carries a metric name and a number, nothing else. "Your games never
 * leave your browser" stays literally true.
 *
 * ROUTES
 *   GET  /api/lookups            -> {count,reviews}  public, drives both on-site counters
 *   GET  /api/stats              -> every counter     private-ish, see STATS_KEY below
 *   POST /api/stats {k,n}        -> increments k by n (n defaults to 1)
 *   POST /api/lookups            -> legacy alias for {k:"lookups"}
 *
 * LOCKING THE STATS DUMP: set a STATS_KEY environment variable in the Netlify UI and
 * GET /api/stats then requires ?key=<that value>. Left unset it is open — these are aggregate
 * counts with nothing personal in them, so an open default beats an endpoint that silently
 * returns nothing until configured.
 */
import { getStore } from "@netlify/blobs";

/* Lookups counted before this endpoint existed: GoatCounter's event/fetch tally at cutover
   (2026-07-31). A floor, not a true total — that undercount is the reason this file exists. */
const BASE_LOOKUPS = 95;
const BLOB = "stats";

/* Allowlist. A public POST endpoint that accepted arbitrary keys could be filled with junk
   until the blob was useless, so unknown names are dropped on the floor. */
const KEYS = new Set([
  "lookups",      // a chess.com account was fetched
  "games",        // games parsed and saved (incremented BY the count, not by one)
  "reviews",      // a game review that ran to completion
  "returning",    // a visit that opened straight from cache — i.e. somebody came back
  "demo",         // sample account opened
  "pwa",          // installed to a home screen
  "compare",      // two accounts compared
  "scout",        // an opponent looked up
  "api_fail",     // a chess.com request that failed even after retries
  "engine_fail",  // Stockfish failed to load or died mid-analysis
]);
const TABS = new Set(["overview","review","insights","blown","mates","log","charts","trends",
                      "openings","tree","endgames","compare","glossary"].map(t => "tab:" + t));

const allowed = k => KEYS.has(k) || TABS.has(k);

const json = (body, status = 200) =>
  Response.json(body, { status, headers: { "cache-control": "no-store" } });

export default async (req) => {
  const url = new URL(req.url);
  const isLookupRoute = url.pathname === "/api/lookups";

  let store;
  try { store = getStore("rookbook"); }
  catch { return json(isLookupRoute ? { count: BASE_LOOKUPS, degraded: true } : { degraded: true }); }

  const read = async (strong) => {
    try {
      const raw = await store.get(BLOB, strong ? { consistency: "strong" } : undefined);
      const o = raw ? JSON.parse(raw) : {};
      return o && typeof o === "object" ? o : {};
    } catch { return {}; }
  };

  if (req.method === "POST") {
    let k = isLookupRoute ? "lookups" : null, n = 1;
    if (!isLookupRoute) {
      try {
        const body = await req.json();
        k = String(body?.k ?? "");
        /* Clamp hard. n is attacker-controlled, and one bogus request should not be able to
           add a billion "games" to a number that gets quoted publicly. 5000 is comfortably
           above the largest real chess.com archive anyone will load in one go. */
        n = Math.min(5000, Math.max(1, Math.floor(Number(body?.n ?? 1)) || 1));
      } catch { return json({ ok: false }, 400); }
    }
    if (!allowed(k)) return json({ ok: false }, 400);

    try {
      /* consistency:"strong" is load-bearing: Blobs reads are eventually consistent by
         default and that lag measures in seconds, long enough that two events a moment apart
         would both read the same value and one would silently vanish.

         Still not atomic — simultaneous writes can cost a count. A deliberate trade against
         the complexity of a lock, and it can only ever undercount, never inflate. */
      const data = await read(true);
      data[k] = (Number(data[k]) || 0) + n;
      await store.set(BLOB, JSON.stringify(data));
      return json({ ok: true });
    } catch { return json({ ok: false, degraded: true }); }
  }

  /* Strong consistency for the stats dump, eventual for the public counter — deliberately not
     the same choice. /api/stats is loaded by hand a few times a day to check a number that was
     just incremented, and reading it stale is the whole complaint; the extra cost is nothing at
     that volume. /api/lookups is hit by every visitor to the homepage, where the figure is social
     proof and being a few seconds behind is invisible. Paying for consistency there would add
     latency to a public page to fix a problem nobody can see. */
  const data = await read(!isLookupRoute);

  /* `reviews` rides along on the public route on purpose. The homepage needs it, and pointing a
     public page at /api/stats would break the moment STATS_KEY is set — and would hand every
     visitor the whole counter dump to read a single number. One request now serves both figures. */
  if (isLookupRoute) return json({
    count: BASE_LOOKUPS + (Number(data.lookups) || 0),
    reviews: Number(data.reviews) || 0,
  });

  /* Read both surfaces. This is a Node function (Blobs does not resolve in the Deno edge
     runtime), where process.env is the standard access path; Netlify.env is the edge-runtime
     API and is not guaranteed to carry the variable here. Setting STATS_KEY and redeploying
     left the endpoint wide open with Netlify.env alone, so try process.env first and fall back.
     Wrapped because referencing an undefined Netlify global would throw and take the whole
     response down — an unreadable key must fail open on a counter dump, not 500. */
  const env = (typeof process !== "undefined" && process.env) ? process.env : {};
  /* Either casing. Env names are case-sensitive on Linux, and the failure mode of getting it
     wrong is that the gate silently does not exist and the endpoint stays open — which is
     exactly the mistake you cannot see from the outside. Cheap insurance. */
  let gate = env.STATS_KEY || env.stats_key || "";
  if (!gate) { try { gate = Netlify.env.get("STATS_KEY") || ""; } catch { gate = ""; } }
  if (gate && url.searchParams.get("key") !== gate) return json({ error: "unauthorized" }, 401);

  const tabs = {};
  for (const [k, v] of Object.entries(data)) if (k.startsWith("tab:")) tabs[k.slice(4)] = v;
  return json({
    lookups: BASE_LOOKUPS + (Number(data.lookups) || 0),
    games: Number(data.games) || 0,
    reviews: Number(data.reviews) || 0,
    returning: Number(data.returning) || 0,
    demo: Number(data.demo) || 0,
    compare: Number(data.compare) || 0,
    scout: Number(data.scout) || 0,
    pwa: Number(data.pwa) || 0,
    failures: { api: Number(data.api_fail) || 0, engine: Number(data.engine_fail) || 0 },
    tabs,
    note: `lookups includes a base of ${BASE_LOOKUPS} carried over from GoatCounter at cutover`,
  });
};

export const config = { path: ["/api/lookups", "/api/stats"] };
