// First-party lookup counter — accurate where the GoatCounter tally undercounts. GoatCounter's
// script (gc.zgo.at) is blocked by ad blockers for a big share of chess players, and it dedups
// events per visitor/day — so the "N accounts looked up" number reads far too low. This endpoint
// is same-origin (rookbook.net/api/lookups), so it can't be ad-blocked, and it keeps a raw running
// total in Netlify Blobs.
//   GET  /api/lookups  -> { count }
//   POST /api/lookups  -> increments, returns { count }
// No personal data is ever sent or stored: a POST is a bare "+1", never which account was looked up.
// "your games never leave your browser" stays literally true.
import { getStore } from "@netlify/blobs";

const KEY = "total";
// Lookups already made before this accurate counter went live (the GoatCounter floor — a real
// lower bound). Seeds the store the first time so the number doesn't reset to an empty 0.
const BASE = 22;

const json = (obj) =>
  new Response(JSON.stringify(obj), {
    headers: {
      "content-type": "application/json",
      "access-control-allow-origin": "*",
      "cache-control": "no-store",
    },
  });

export default async (request) => {
  try {
    const store = getStore({ name: "lookups", consistency: "strong" });
    const cur = await store.get(KEY, { type: "json" });
    let n = cur ? Number(cur.n) || 0 : BASE;
    if (request.method === "POST") {
      n += 1;
      await store.setJSON(KEY, { n });
    } else if (!cur) {
      // seed the store on the very first read so GET and POST agree from the start
      await store.setJSON(KEY, { n });
    }
    return json({ count: n });
  } catch (_) {
    // never error the caller — the UI reads this best-effort and fails silent
    return json({ count: null });
  }
};
