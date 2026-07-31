// Netlify Edge Function — server-render /player/<username> so the page is indexable by Google:
// a unique <title>, meta description, OG tags and canonical, plus a crawlable stats summary,
// pulled live from Chess.com's public API (light calls only — profile + per-format stats, no game
// archives, so it stays fast at the edge). The client app then hydrates the full interactive
// analysis on top. Runs on Deno. Deploy via Git or `netlify deploy` — drag-and-drop won't run it.

const UA = "Rookbook (rookbook.net) player page - contact rookbookchess@gmail.com";
const SITE = "https://rookbook.net";

const esc = (s) =>
  String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const num = (n) => (typeof n === "number" ? n.toLocaleString("en-US") : "0");

const record = (r) => {
  if (!r) return null;
  const w = r.win || 0, l = r.loss || 0, d = r.draw || 0, t = w + l + d;
  return t ? { w, l, d, t, wr: Math.round((100 * w) / t) } : null;
};

// Feature deep-link pages: /player/<user>/<slug>. Each is a distinct, indexable page with its own
// title/description/intro so Google doesn't treat them as duplicates of the base player page. The
// client app (app.html) maps the same slugs to tabs. {name} is replaced with the player's name.
// Copy is deliberately unique per feature (no shared sentence shapes). Keep in sync with FEATURE_SLUGS
// in app.html and the PLAYERS/feature list in build-sitemap.py.
const FEATURES = {
  "playing-style": {
    title: "{name} — Playing Style & Chess DNA | Rookbook",
    desc: "{name}'s chess playing style, mapped across six axes — attack, defense, conversion, clock — plus a plain-English archetype. Aggressive or positional?",
    h1: "{name}'s chess playing style",
    intro: "Every player has a shape. Rookbook charts {name}'s game across six axes — attack, defense, conversion, tactical sharpness, clock management, and how they recover from a blunder — then names the resulting archetype in plain English. Whether you win by pressing or by grinding tells you which strengths to lean on and which holes to patch.",
    cta: "Run the full analysis to watch {name}'s complete Chess DNA radar build live in your browser.",
  },
  "blown-leads": {
    title: "{name} — Blown Winning Positions | Rookbook",
    desc: "{name} keeps turning won games into draws and losses. Rookbook flags every winning position blown and pinpoints the move it slipped away.",
    h1: "{name}'s blown leads",
    intro: "Getting to a winning position is the hard part, and {name} clearly manages it. The expensive habit is what comes next: letting a game that was in hand drift into a draw or a loss. This page gathers those games and marks the moment the advantage began to slip, so the pattern behind the result is easy to see and easy to drill.",
    cta: "See every game {name} let slip, move by move, in the full in-browser analysis.",
  },
  "missed-mates": {
    title: "{name} — Missed Forced Checkmates | Rookbook",
    desc: "Forced checkmates {name} left on the board — the mate-in-N sequences played right past. Review each one and train your eye to spot the finish.",
    h1: "Missed checkmates in {name}'s games",
    intro: "A forced checkmate is a finish the opponent cannot escape — mate in one, two, sometimes a longer chain — and it is easy to walk straight past one with the clock ticking. This page collects the games where {name} had a mate available and chose another move, then lays the position beside the move that would have ended it. Missing forced mates is among the most fixable mistakes in club chess, and studying your own near-finishes is how the pattern starts to jump out mid-game.",
    cta: "Run the full in-browser analysis to see every forced mate {name} walked past.",
  },
  "openings": {
    title: "{name} — Opening Repertoire & Win Rates | Rookbook",
    desc: "{name}'s opening repertoire as White and Black, with the win rate for every line and the ones quietly bleeding points. See what to keep and cut.",
    h1: "{name}'s opening repertoire",
    intro: "A repertoire is just the set of openings you keep returning to, and it is rarely as even as it feels — some lines quietly win you games while others leak points every time out. This page sorts {name}'s White and Black openings by how they actually score, then drills into the variations where the wheels come off. That tells you which lines to trust and which to retire or go study.",
    cta: "Open the full in-browser breakdown to see every line ranked and know what to reach for next.",
  },
  "endgames": {
    title: "{name} — Endgame Conversion & Technique | Rookbook",
    desc: "Endgame conversion decides quiet games, and {name} keeps handing points back in rook endings and won pawn endgames. Rookbook grades the technique.",
    h1: "{name}'s endgame conversion",
    intro: "An extra pawn or a rook ending you should hold is only worth something once the board thins out and there is nowhere left to bluff. This page walks {name}'s late-game positions — the ones that reached a real endgame with the result still there for the taking — and flags the ones that came up short. Tightening this phase is unglamorous work, and it is also where a lot of rating points get won back.",
    cta: "Open the full in-browser breakdown to replay every endgame {name} let slip and see where the technique cracked.",
  },
  "tilt": {
    title: "{name} — Tilt and Form Over Time | Rookbook",
    desc: "Tilt is real: {name}'s form after a loss, whether long sessions and late nights sink the rating, and the moment to log off before it costs points.",
    h1: "Does {name} actually tilt?",
    intro: "Tilt is when one loss bleeds into the next and you play the following game angrier, faster, and worse. This page charts {name}'s form across a single sitting: how the games right after a defeat go, the point where fatigue starts eating accuracy, and which hours of the day tend to run hot or cold. Learning to close the app at the right moment is its own quiet rating gain.",
    cta: "Run the full breakdown in your browser to see exactly when {name} should stop for the day.",
  },
  "game-review": {
    title: "{name} — Free Game Review, Move by Move | Rookbook",
    desc: "Review {name}'s chess.com games move by move with a free in-browser engine: every blunder and mistake priced in win chance, plus the checkmates that went unplayed. No daily limit.",
    h1: "Review {name}'s games move by move",
    intro: "Pick any of {name}'s recent chess.com games and walk it on a board with an engine running locally in your browser. Each costly move is priced in the win chance it threw away, the engine's better idea is drawn as an arrow, and forced mates that went unplayed get their own count. Chess.com sells this as Game Review; here it has no daily limit and needs no membership.",
    cta: "Open the review board and step through {name}'s latest game, blunder by blunder, free.",
  },
};

export default async (request, context) => {
  // The app shell, via the /player/* -> /app.html rewrite in _redirects.
  const res = await context.next();
  const ct = res.headers.get("content-type") || "";
  if (!ct.includes("text/html")) return res;

  let html;
  try { html = await res.text(); } catch (_) { return res; }

  try {
    const url = new URL(request.url);
    const m = /^\/player\/([^\/?#]+)(?:\/([^\/?#]+))?/i.exec(url.pathname);
    if (!m) return new Response(html, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } });
    const raw = decodeURIComponent(m[1]).trim();
    const user = raw.toLowerCase();
    // Decode defensively: a malformed %-escape (e.g. /player/hikaru/%E0) makes decodeURIComponent
    // throw. Fall back to the raw segment so it's treated as an unknown slug (noindex) instead of
    // throwing to the outer catch, which would serve the bare shell with no noindex.
    let slug = "";
    if (m[2]) { try { slug = decodeURIComponent(m[2]); } catch (_) { slug = m[2]; } slug = slug.trim().toLowerCase(); }
    const feat = FEATURES[slug] || null;   // a known feature page, or null for the base player page

    // Light server-side data pull; a failure just yields generic metadata, never a broken page.
    let profile = null, stats = null;
    try {
      const opt = { headers: { "User-Agent": UA, "Accept": "application/json" } };
      const [pr, st] = await Promise.all([
        fetch(`https://api.chess.com/pub/player/${encodeURIComponent(user)}`, opt),
        fetch(`https://api.chess.com/pub/player/${encodeURIComponent(user)}/stats`, opt),
      ]);
      if (pr.ok) profile = await pr.json();
      if (st.ok) stats = await st.json();
    } catch (_) { /* generic metadata below */ }

    const exists = !!(profile && profile.username);
    const name = exists ? (profile.name || profile.username) : raw;
    // Function replacer: a returned string is inserted literally, so a name containing $ / $& / $`
    // can't be misread as a replacement pattern. ({name} -> player name; esc'd at insertion.)
    const fill = (s) => String(s).replace(/\{name\}/g, () => name);

    const FMT = [["chess_rapid", "Rapid"], ["chess_blitz", "Blitz"], ["chess_bullet", "Bullet"], ["chess_daily", "Daily"]];
    const rows = [];
    let W = 0, L = 0, D = 0, topR = 0, topF = "";
    if (stats) for (const [k, label] of FMT) {
      const s = stats[k]; if (!s) continue;
      const r = record(s.record), rating = s.last && s.last.rating;
      if (r) { W += r.w; L += r.l; D += r.d; }
      if (rating && rating > topR) { topR = rating; topF = label; }
      if (r || rating) rows.push({ label, rating: rating || null, r });
    }
    const T = W + L + D, WR = T ? Math.round((100 * W) / T) : null;

    // ---- Metadata ----
    const base = `${SITE}/player/${encodeURIComponent(user)}`;
    let title, desc;
    if (feat && exists) {
      title = fill(feat.title);
      desc = fill(feat.desc);
    } else if (exists) {
      title = `${name} — Chess.com stats & insights | Rookbook`;
      const bits = [];
      if (topR) bits.push(`${topF} ${num(topR)}`);
      if (T) bits.push(`${num(T)} rated games`);
      if (WR != null) bits.push(`${WR}% win rate`);
      desc = `${name}'s Chess.com stats${bits.length ? ": " + bits.join(", ") : ""} — plus blown leads, missed checkmates, opening leaks and a playing-style breakdown. Free, no account.`;
    } else {
      title = `${raw} — Chess.com stats | Rookbook`;
      desc = `Chess.com stats and insights for ${raw} on Rookbook — blown leads, missed checkmates, opening leaks and more. Free, runs in your browser.`;
    }
    // Canonical is always self-referential: any request carrying a slug (a real feature OR an
    // unknown one) canonicalizes to its own path. Pointing an unknown-slug noindex page at the
    // indexable base would be a contradictory signal (noindex here, canonical elsewhere).
    const canon = slug ? `${base}/${slug}` : base;
    // Index real player pages and real feature pages; noindex a missing user or an unknown slug.
    const indexable = exists && (!slug || !!feat);

    // ---- Crawlable summary ----
    const statsBlock = () => {
      let s = "";
      if (T) s += `<p>${esc(name)} has ${num(T)} rated games on record${WR != null ? ` with a ${WR}% win rate` : ""}${topR ? `, peaking at ${num(topR)} ${esc(topF)}` : ""}.</p>`;
      if (rows.length) {
        s += `<table><thead><tr><th>Format</th><th>Rating</th><th>W</th><th>L</th><th>D</th><th>Win&nbsp;rate</th></tr></thead><tbody>`;
        for (const r of rows) s += `<tr><td>${esc(r.label)}</td><td>${r.rating ? num(r.rating) : "—"}</td><td>${r.r ? r.r.w : "—"}</td><td>${r.r ? r.r.l : "—"}</td><td>${r.r ? r.r.d : "—"}</td><td>${r.r ? r.r.wr + "%" : "—"}</td></tr>`;
        s += `</tbody></table>`;
      }
      return s;
    };

    let ssr;
    if (feat && exists) {
      // One feature's landing page: its unique intro, the shared stats table for context, then a
      // link back to the base player page (concentrates internal links on the canonical hub).
      ssr = `<section class="ssrbox"><h1>${esc(fill(feat.h1))}</h1>`;
      ssr += `<p>${esc(fill(feat.intro))}</p>`;
      ssr += statsBlock();
      ssr += `<p>${esc(fill(feat.cta))} <a href="${esc(base)}">See ${esc(name)}'s full Rookbook analysis →</a></p>`;
      ssr += `</section>`;
    } else if (exists) {
      // The base player page. Its feature mentions are real links, so each feature page gets an
      // internal link pointing at it — the strongest discovery signal after the sitemap.
      ssr = `<section class="ssrbox"><h1>${esc(name)} — Chess.com stats</h1>`;
      ssr += statsBlock();
      ssr += `<p>Rookbook reads ${esc(name)}'s full Chess.com history right in your browser — `
           + `<a href="${esc(base)}/blown-leads">blown leads</a>, `
           + `<a href="${esc(base)}/missed-mates">missed checkmates</a>, `
           + `<a href="${esc(base)}/openings">opening leaks</a>, `
           + `<a href="${esc(base)}/endgames">endgame conversion</a>, `
           + `<a href="${esc(base)}/tilt">tilt after a loss</a>, and a `
           + `<a href="${esc(base)}/playing-style">six-axis Chess-DNA playing-style radar</a> — `
           + `and a <a href="${esc(base)}/game-review">free move-by-move game review</a> of any game. `
           + `<a href="${esc(base)}">Open the full analysis →</a></p>`;
      ssr += `</section>`;
    } else {
      ssr = `<section class="ssrbox"><h1>${esc(name)} — Chess.com stats</h1>`;
      ssr += `<p>We couldn't find recent public data for <b>${esc(raw)}</b> on Chess.com. Double-check the username, or <a href="${SITE}/">try another player →</a></p>`;
      ssr += `</section>`;
    }

    // Function replacers throughout: a returned string is inserted verbatim, so $ / $& / $` in a
    // player's display name (via title/desc/ssr) can never be misread as a replacement pattern.
    html = html
      .replace(/<title>[\s\S]*?<\/title>/i, () => `<title>${esc(title)}</title>`)
      .replace(/<meta name="description"[^>]*>/i, () => `<meta name="description" content="${esc(desc)}">`)
      .replace(/<link rel="canonical"[^>]*>/i, () => `<link rel="canonical" href="${esc(canon)}">`)
      .replace(/<meta property="og:title"[^>]*>/i, () => `<meta property="og:title" content="${esc(title)}">`)
      .replace(/<meta property="og:description"[^>]*>/i, () => `<meta property="og:description" content="${esc(desc)}">`)
      .replace(/<meta property="og:url"[^>]*>/i, () => `<meta property="og:url" content="${esc(canon)}">`)
      .replace("<!--SSR-->", () => ssr);

    return new Response(html, {
      status: 200,
      headers: {
        "content-type": "text/html; charset=utf-8",
        // Cache indexable pages hard (repeat crawls/visits are cheap; stats stay fresh-ish). But a
        // NON-indexable render is often a transient miss — a chess.com rate-limit or timeout leaves
        // a sitemap-listed player looking absent. Cache those only briefly, so a blip can't pin a
        // curated page as noindex for an hour; it self-heals on the next crawl.
        "cache-control": indexable
          ? "public, max-age=0, s-maxage=3600, stale-while-revalidate=86400"
          : "public, max-age=0, s-maxage=60",
        // Index real player + feature pages; keep a missing user or an unknown slug out of the index.
        "x-robots-tag": indexable ? "index, follow" : "noindex, follow",
      },
    });
  } catch (_) {
    // Any failure: serve the untouched app shell rather than an error.
    return new Response(html, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } });
  }
};
