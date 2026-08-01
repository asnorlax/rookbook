/* Resolve a chess.com game id to the two facts the browser needs to fetch that game itself.
 *
 * WHY THIS EXISTS: chess.com's documented API is keyed by player and month, not by game id —
 * there is no by-id endpoint. The undocumented one, /callback/live/game/<id>, does know who
 * played and when, but it answers with no access-control-allow-origin header, so a browser on
 * rookbook.net cannot read it. A server can. That single lookup is the only thing here.
 *
 * WHAT IT DELIBERATELY DOES NOT DO: return the game. api.chess.com sends
 * `access-control-allow-origin: *`, so once the browser knows the player and the month it can
 * pull the archive straight from chess.com — which is what the app already does for accounts.
 * Proxying the moves through here would put a 2-3 MB archive through Netlify for every review,
 * for no benefit. The response below is about 120 bytes.
 *
 * It also cannot use /callback's own move list even if it wanted to: that endpoint returns
 * moves in chess.com's proprietary encoding, not SAN, with clocks in a separate array. The
 * archive PGN is the real thing, clocks included, and it is what the reviewer already parses.
 *
 * PRIVACY, HONESTLY: this takes a game id and returns two usernames and a date. No game data,
 * no history, no storage, nothing written anywhere. The one caveat worth stating plainly: the
 * id travels as a query string, so it lands in Netlify's ordinary access logs like any URL. For
 * a public game that is close to meaningless, but if someone reviews their own game the id is
 * resolvable back to their username by anyone holding those logs. Switch to POST if that ever
 * matters more than CDN caching does.
 *
 * BRITTLENESS: /callback is undocumented and can change without notice. Every failure here is
 * therefore a soft one — the client is expected to fall back to "paste the PGN instead", which
 * needs no network at all.
 *
 * ROUTE
 *   GET /api/game?id=172252535830  ->  {ok,id,white,black,year,month,date,url}
 */

/* The id->player+date mapping for a finished game never changes, so cache it hard. This is also
   what keeps traffic off an undocumented endpoint: one lookup per game, ever, per edge node. */
const json = (body, status = 200) =>
  Response.json(body, {
    status,
    headers: {
      "cache-control": status === 200
        ? "public, max-age=86400, s-maxage=604800"
        : "no-store",
    },
  });

/* chess.com serves live and daily games from different callback paths, and a daily game id fed
   to the live path 404s. Try both rather than making the caller know which kind it holds. */
const KINDS = ["live", "daily"];

export default async (req) => {
  const id = ((new URL(req.url).searchParams.get("id") || "").match(/\d{6,}/) || [])[0] || "";
  if (!id) return json({ ok: false, err: "bad_id" }, 400);

  let headers = null;
  for (const kind of KINDS) {
    let r;
    try {
      r = await fetch(`https://www.chess.com/callback/${kind}/game/${id}`, {
        headers: {
          /* Identify the caller. An unlabeled server-side scraper is the thing most likely to
             get blocked, and this is a good-faith single lookup for a public game. */
          "user-agent": "rookbook.net (+https://rookbook.net)",
          accept: "application/json",
        },
      });
    } catch {
      return json({ ok: false, err: "upstream" }, 502);
    }
    if (r.status === 404) continue;                       // wrong kind, or no such game
    if (!r.ok) return json({ ok: false, err: "upstream" }, 502);

    let d;
    try { d = await r.json(); } catch { return json({ ok: false, err: "upstream" }, 502); }
    const h = d && d.game && d.game.pgnHeaders;
    if (h && h.White && h.Black && h.Date) { headers = h; break; }
  }

  if (!headers) return json({ ok: false, err: "not_found" }, 404);

  /* PGN dates are "2026.07.29". The archive path wants the year and month as separate,
     zero-padded segments, so hand them over already split rather than making the client
     re-parse a format it never sees anywhere else. */
  const [year, month] = headers.Date.split(".");
  if (!year || !month) return json({ ok: false, err: "not_found" }, 404);

  return json({
    ok: true,
    id,
    white: headers.White,
    black: headers.Black,
    year,
    month,
    date: headers.Date,
    url: `https://www.chess.com/game/live/${id}`,
  });
};

export const config = { path: "/api/game" };
