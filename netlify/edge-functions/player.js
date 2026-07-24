// Netlify Edge Function — server-render /player/<username> so the page is indexable by Google:
// a unique <title>, meta description, OG tags and canonical, plus a crawlable stats summary,
// pulled live from Chess.com's public API (light calls only — profile + per-format stats, no game
// archives, so it stays fast at the edge). The client app then hydrates the full interactive
// analysis on top. Runs on Deno. Deploy via Git or `netlify deploy` — drag-and-drop won't run it.

const UA = "Rookbook (rookbook.net) player page — contact rookbookchess@gmail.com";
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

export default async (request, context) => {
  // The app shell, via the /player/* -> /app.html rewrite in _redirects.
  const res = await context.next();
  const ct = res.headers.get("content-type") || "";
  if (!ct.includes("text/html")) return res;

  let html;
  try { html = await res.text(); } catch (_) { return res; }

  try {
    const url = new URL(request.url);
    const m = /^\/player\/([^\/?#]+)/i.exec(url.pathname);
    if (!m) return new Response(html, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } });
    const raw = decodeURIComponent(m[1]).trim();
    const user = raw.toLowerCase();

    // Light server-side data pull; a failure just yields generic metadata, never a broken page.
    let profile = null, stats = null;
    try {
      const opt = { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(2500) };
      const [pr, st] = await Promise.all([
        fetch(`https://api.chess.com/pub/player/${encodeURIComponent(user)}`, opt),
        fetch(`https://api.chess.com/pub/player/${encodeURIComponent(user)}/stats`, opt),
      ]);
      if (pr.ok) profile = await pr.json();
      if (st.ok) stats = await st.json();
    } catch (_) { /* generic metadata below */ }

    const exists = !!(profile && profile.username);
    const name = exists ? (profile.name || profile.username) : raw;

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
    let title, desc;
    if (exists) {
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
    const canon = `${SITE}/player/${encodeURIComponent(user)}`;

    // ---- Crawlable summary ----
    let ssr = `<section class="ssrbox"><h1>${esc(name)} — Chess.com stats</h1>`;
    if (exists) {
      if (T) ssr += `<p>${esc(name)} has ${num(T)} rated games on record${WR != null ? ` with a ${WR}% win rate` : ""}${topR ? `, peaking at ${num(topR)} ${esc(topF)}` : ""}.</p>`;
      if (rows.length) {
        ssr += `<table><thead><tr><th>Format</th><th>Rating</th><th>W</th><th>L</th><th>D</th><th>Win&nbsp;rate</th></tr></thead><tbody>`;
        for (const r of rows) ssr += `<tr><td>${esc(r.label)}</td><td>${r.rating ? num(r.rating) : "—"}</td><td>${r.r ? r.r.w : "—"}</td><td>${r.r ? r.r.l : "—"}</td><td>${r.r ? r.r.d : "—"}</td><td>${r.r ? r.r.wr + "%" : "—"}</td></tr>`;
        ssr += `</tbody></table>`;
      }
      ssr += `<p>Rookbook reads ${esc(name)}'s full Chess.com history right in your browser — blown leads, missed checkmates, opening leaks, endgame conversion, tilt after a loss, and a six-axis Chess-DNA playing-style radar. <a href="${esc(canon)}">Open the full analysis →</a></p>`;
    } else {
      ssr += `<p>We couldn't find recent public data for <b>${esc(raw)}</b> on Chess.com. Double-check the username, or <a href="${SITE}/">try another player →</a></p>`;
    }
    ssr += `</section>`;

    html = html
      .replace(/<title>[\s\S]*?<\/title>/i, `<title>${esc(title)}</title>`)
      .replace(/<meta name="description"[^>]*>/i, `<meta name="description" content="${esc(desc)}">`)
      .replace(/<link rel="canonical"[^>]*>/i, `<link rel="canonical" href="${esc(canon)}">`)
      .replace(/<meta property="og:title"[^>]*>/i, `<meta property="og:title" content="${esc(title)}">`)
      .replace(/<meta property="og:description"[^>]*>/i, `<meta property="og:description" content="${esc(desc)}">`)
      .replace(/<meta property="og:url"[^>]*>/i, `<meta property="og:url" content="${esc(canon)}">`)
      .replace("<!--SSR-->", ssr);

    return new Response(html, {
      status: 200,
      headers: {
        "content-type": "text/html; charset=utf-8",
        // Cache the rendered page at the CDN so repeat crawls/visits are cheap; stats stay fresh-ish.
        "cache-control": "public, max-age=0, s-maxage=3600, stale-while-revalidate=86400",
        // Don't let Google index pages for usernames that returned nothing.
        "x-robots-tag": exists ? "index, follow" : "noindex, follow",
      },
    });
  } catch (_) {
    // Any failure: serve the untouched app shell rather than an error.
    return new Response(html, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } });
  }
};
