#!/usr/bin/env python3
"""
build-sitemap.py — regenerate sitemap.xml from the files actually on disk.

    python build-sitemap.py

The sitemap used to be edited by hand, which meant lastmod drifted: pages edited
today still claimed last week, and two claimed to be newer than the file was. Google
only trusts lastmod when it looks reliable, so a drifting one is worse than none.

Every .html page ships except the ones listed in SKIP below. Run it before deploying
whenever you have added or changed a page.

lastmod comes from git's last-commit date for each file, not the filesystem mtime: a
clone or checkout rewrites every file with today's mtime, which would falsely flag the
whole site as changed today. A file with uncommitted edits is changing right now, so it
uses its mtime instead; if git isn't available it falls back to mtime everywhere.

Standard library only (git is invoked if present, with a graceful mtime fallback).
"""

import datetime
import os
import re
import subprocess
import sys

BASE = "https://rookbook.net/"

# Curated player profiles. These /player/<user> pages have no file on disk — the Netlify edge
# function (netlify/edge-functions/player.js) server-renders them with real, indexable stats —
# so they must be listed explicitly or a crawler never learns they exist. High-profile accounts
# whose pages carry substantial content and draw name-search traffic. Usernames are lowercase /
# canonical (exactly what chess.com's API returns, and what the page's <link rel=canonical> uses).
#
# lastmod is deliberately OMITTED for these: the stats update continuously and we can't know when,
# so any date would be a guess — and not lying about freshness is this whole script's reason to exist.
PLAYERS = [
    "magnuscarlsen",
    "hikaru",
    "gothamchess",
    "alexandrabotez",
    "danielnaroditsky",
    "annacramling",
    "chessbrah",
    "nemsko",
]

# app.html is the tool itself — a single-page app. It used to be skipped on the theory that
# its runtime-generated content gives a crawler nothing to index, but a crawler never types a
# username: it sees the static welcome shell (hero, feature grid, how-it-works), which is real,
# stable content, and the page is self-canonical. It's the product and the best landing page
# for high-intent queries ("chess.com game tracker"), so it now ships in the sitemap too.
# google*.html is Search Console's verification stub, and _-prefixed files are scratch — both
# are still excluded, in should_ship() below.
SKIP = set()


def should_ship(name):
    if not name.endswith(".html"):
        return False
    if name in SKIP or name.startswith("_") or name.startswith("google"):
        return False
    return True


def last_change(folder, name):
    """Date a page's CONTENT last changed, as YYYY-MM-DD.

    Prefer git's last-commit date: filesystem mtime is unreliable because a clone/checkout
    stamps every file with today's date. Two exceptions fall back to mtime — a file with
    uncommitted edits (it's changing now, so the stale commit date would under-report) and
    the case where git isn't available or doesn't know the file."""
    path = os.path.join(folder, name)
    mdate = datetime.date.fromtimestamp(os.path.getmtime(path)).isoformat()

    def git(*args):
        return subprocess.run(["git", "-C", folder, *args],
                              capture_output=True, text=True, timeout=10)

    try:
        dirty = git("status", "--porcelain", "--", name)
        if dirty.returncode == 0 and dirty.stdout.strip():
            return mdate                     # uncommitted edits -> the change is happening now
        committed = git("log", "-1", "--format=%cs", "--", name)
        if committed.returncode == 0 and committed.stdout.strip():
            return committed.stdout.strip()  # %cs = committer date, short (YYYY-MM-DD)
    except Exception:
        pass                                 # no git, timeout, etc. -> mtime
    return mdate


def main():
    folder = sys.argv[1] if len(sys.argv) > 1 else os.path.dirname(os.path.abspath(__file__)) or "."
    pages = sorted(f for f in os.listdir(folder) if should_ship(f))
    if not pages:
        print(f"No pages found in {os.path.abspath(folder)}")
        return 1

    old = ""
    sm = os.path.join(folder, "sitemap.xml")
    if os.path.exists(sm):
        old = open(sm, encoding="utf-8").read()
    # anchor on BASE: a non-greedy [^<]*?/ matches at "https:/" and captures the whole
    # rest of the URL, so every page looks new and the report lies about what changed
    was = dict(re.findall(re.escape(BASE) + r"([^<]*)</loc>\s*<lastmod>([^<]+)</lastmod>", old))

    lines = ['<?xml version="1.0" encoding="UTF-8"?>',
             '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">']
    rows = []
    for p in pages:
        # index.html is the site root; everything else keeps its filename, matching the
        # canonical tag on the page itself
        loc = BASE if p == "index.html" else BASE + p
        lastmod = last_change(folder, p)
        lines += ["  <url>", f"    <loc>{loc}</loc>", f"    <lastmod>{lastmod}</lastmod>", "  </url>"]
        prev = was.get("" if p == "index.html" else p)
        rows.append((p, prev, lastmod))
    # Curated /player/<user> pages — no file, no lastmod (see PLAYERS note above).
    for user in PLAYERS:
        lines += ["  <url>", f"    <loc>{BASE}player/{user}</loc>", "  </url>"]
    lines.append("</urlset>")
    out = "\n".join(lines) + "\n"

    open(sm, "w", encoding="utf-8", newline="\n").write(out)

    changed = sum(1 for _, prev, now in rows if prev != now)
    print(f"{len(pages)} pages + {len(PLAYERS)} player profiles -> sitemap.xml   ({changed} lastmod corrected)\n")
    print(f"{'PAGE':<46}{'WAS':<12}{'NOW':<12}")
    print("-" * 70)
    for p, prev, now in rows:
        mark = "" if prev == now else "  updated"
        print(f"{p:<46}{prev or '(new)':<12}{now:<12}{mark}")
    skipped = sorted(f for f in os.listdir(folder)
                     if f.endswith(".html") and not should_ship(f))
    if skipped:
        print(f"\nnot listed: {', '.join(skipped)}")
    return 0


if __name__ == "__main__":
    # Any crash must be visible. Without this, an unexpected error on a double-click
    # closes the console instantly and the script looks like it "did nothing".
    try:
        code = main()
    except Exception:
        import traceback
        print("\nbuild-sitemap.py hit an unexpected error:\n")
        traceback.print_exc()
        code = 2
    # Double-clicking on Windows runs the script in a console that closes the moment it
    # exits, so the output flashes past unread. No folder argument is what a double-click
    # looks like — hold the window open so the report can actually be read.
    if len(sys.argv) == 1:
        try:
            input("\nPress Enter to close...")
        except (EOFError, KeyboardInterrupt):
            pass
    sys.exit(code)
