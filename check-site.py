#!/usr/bin/env python3
"""
check-site.py — pre-deploy validator for the Rookbook Reading pages.

Run it on the folder of generated .html files BEFORE you deploy:

    python check-site.py .

Exit code 0 = clean, 1 = problems found. Every check here exists because the
problem it catches actually shipped at least once.

No dependencies. Standard library only.
"""

import sys, os, re, json, glob
from html.parser import HTMLParser

# ---------------------------------------------------------------- helpers

# The Windows console often runs a legacy codepage (cp1252) that cannot encode
# box-drawing or typographic characters. Printing one raises UnicodeEncodeError and,
# on a double-click, the window closes before you can read the traceback. So: try to
# switch stdout to UTF-8, and fall back to plain ASCII output if that is not possible.
UNICODE_OK = True
try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    enc = (getattr(sys.stdout, "encoding", "") or "").lower()
    UNICODE_OK = "utf" in enc

RED, YEL, GRN, DIM, OFF = "\033[31m", "\033[33m", "\033[32m", "\033[2m", "\033[0m"
if os.name == "nt" and not os.environ.get("WT_SESSION"):
    RED = YEL = GRN = DIM = OFF = ""      # old conhost doesn't do colour

# Every glyph below has an ASCII fallback, so the report is readable anywhere.
BAD  = "\u2717" if UNICODE_OK else "X"
WARN = "!"
BAR  = "\u2588" if UNICODE_OK else "#"
DASH = "\u2014" if UNICODE_OK else "-"
ELL  = "\u2026" if UNICODE_OK else "..."

problems, warnings = [], []
def fail(f, msg): problems.append((f, msg))
def warn(f, msg): warnings.append((f, msg))


def visible_only(html):
    """Strip <script> and <style> entirely before looking for leaked escapes.

    A \\u2014 inside JavaScript or JSON-LD is legitimate source code, not a bug. Only
    escapes in prose, attributes and captions are the leak we care about."""
    html = re.sub(r"<script\b[^>]*>.*?</script>", "", html, flags=re.S | re.I)
    html = re.sub(r"<style\b[^>]*>.*?</style>", "", html, flags=re.S | re.I)
    return html


VOID = {"img", "br", "hr", "input", "meta", "link", "source", "area",
        "base", "col", "embed", "param", "track", "wbr"}


class TextOf(HTMLParser):
    """Collect the text content of the first element with a given class."""
    def __init__(self, cls):
        super().__init__(); self.cls = cls; self.depth = 0; self.out = []; self.done = False
    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        # void elements never get an end tag, so they must not move the depth counter
        if self.depth:
            if tag not in VOID: self.depth += 1
        elif not self.done and self.cls in (a.get("class") or "").split():
            self.depth = 1
    def handle_endtag(self, tag):
        if self.depth:
            self.depth -= 1
            if self.depth == 0: self.done = True
    def handle_data(self, data):
        if self.depth: self.out.append(data)
    @property
    def text(self): return "".join(self.out)


# ---------------------------------------------------------------- checks

def is_article_page(html):
    """True for pages built from the Reading template. The app itself, old app builds
    and verification stubs live in the same folder and must not be audited as articles."""
    if 'class="wm"' not in html:
        return False
    css = "\n".join(re.findall(r"<style>(.*?)</style>", html, flags=re.S))
    return ".wm{" in css.replace(" ", "")


def check_wordmark(f, html):
    """The brand is ONE word. A flex `gap` on .wm inserts space between every flex
       item — including between <b>rook</b> and <i>book</i> — so the header renders
       'rook book'. This shipped on all 10 pages, in two different gap values."""
    p = TextOf("wm"); p.feed(html)
    text = p.text.strip()
    if not text:
        warn(f, "no .wm wordmark found on this page")
        return
    if text != "rookbook":
        fail(f, f"wordmark renders as {text!r}, expected 'rookbook'")

    css = "\n".join(re.findall(r"<style>(.*?)</style>", html, flags=re.S))
    m = re.search(r"\.wm\{[^}]*\}", css, flags=re.S)
    if m and re.search(r"gap:\s*[0-9.]+px", m.group(0)):
        fail(f, "`.wm` has a flex `gap` - it will split the wordmark. "
                "Move it to `.wm img{margin-right:...}`")


def check_escapes(f, html):
    """Literal \\u2014 / \\u2019 leaking into visible text. Shipped in figcaptions
       and alt attributes on 3 pages, because those strings took a different path
       through the build than the body copy did."""
    body = visible_only(html)
    for m in re.finditer(r"\\u[0-9a-fA-F]{4}", body):
        s = max(0, m.start() - 40)
        ctx = body[s:m.end() + 40].replace("\n", " ")
        fail(f, f"literal escape {m.group(0)} in visible content: {ELL}{ctx}{ELL}")


def check_jsonld(f, html):
    for block in re.findall(r'<script type="application/ld\+json">(.*?)</script>', html, flags=re.S):
        try:
            json.loads(block)
        except json.JSONDecodeError as e:
            fail(f, f"JSON-LD does not parse: {e}")


def check_head(f, html):
    head = html.split("</head>")[0]
    title = re.search(r"<title>(.*?)</title>", head, flags=re.S)
    if not title or not title.group(1).strip():
        fail(f, "missing <title>")
    elif len(title.group(1)) > 65:
        warn(f, f"<title> is {len(title.group(1))} chars - likely truncated in search results")

    desc = re.search(r'<meta name="description" content="(.*?)"', head, flags=re.S)
    if not desc:
        fail(f, "missing meta description")
    elif len(desc.group(1)) > 165:
        warn(f, f"meta description is {len(desc.group(1))} chars - likely truncated")

    # canonical and og:url must point at THIS file, not a copy-paste of another
    for prop, pat in (("canonical", r'<link rel="canonical" href="([^"]+)"'),
                      ("og:url", r'<meta property="og:url" content="([^"]+)"')):
        m = re.search(pat, head)
        if not m:
            fail(f, f"missing {prop}")
        elif not points_at_self(m.group(1), os.path.basename(f)):
            fail(f, f"{prop} points at {m.group(1)} but this file is {os.path.basename(f)}")


def points_at_self(url, fname):
    """Does this canonical / og:url address the file it lives in?

    index.html is the site root, so its canonical is the bare domain — correct, and not
    the copy-paste mistake this check exists to catch. Everything else must name itself.
    Matching on "/" + filename rather than a bare suffix also stops a page like
    /losing-winning-positions.html from being satisfied by /positions.html."""
    path = re.sub(r"^[a-z]+://[^/]+", "", url, flags=re.I)   # drop scheme + host
    path = path.rstrip("/") or "/"
    if fname == "index.html":
        return path in ("/", "/index.html")
    stem = fname[:-5] if fname.endswith(".html") else fname
    return path.endswith("/" + fname) or path.endswith("/" + stem)


def check_images(f, html):
    for m in re.finditer(r"<img\s([^>]*)>", html):
        attrs = m.group(1)
        if 'alt=' not in attrs:
            fail(f, f"<img> with no alt attribute: {m.group(0)[:70]}{ELL}")
        if "width=" not in attrs or "height=" not in attrs:
            warn(f, f"<img> without width/height (causes layout shift): {m.group(0)[:70]}{ELL}")


def check_links(articles, all_pages):
    """Dangling internal links, and pages nothing links to.

    Link targets are checked against EVERY .html in the folder, not just the article
    ones: app.html and the search-verification stubs are perfectly good things to link
    to even though they aren't audited as articles. Counting inbound links stays limited
    to articles, since that's what the orphan report is about."""
    have = {os.path.basename(f) for f in all_pages}
    inbound = {os.path.basename(f): 0 for f in articles}
    for f in articles:
        html = open(f, encoding="utf-8").read()
        me = os.path.basename(f)
        for href in set(re.findall(r'href="/([^"]*\.html)"', html)):
            if href not in have:
                fail(me, f"links to /{href}, which does not exist in this folder")
            elif href != me and href in inbound:
                inbound[href] += 1
        # the homepage is linked as "/" rather than "/index.html", so count that too —
        # otherwise the site's most-linked page reports as unreachable
        if me != "index.html" and "index.html" in inbound \
                and re.search(r'href="/(?:index\.html)?"', html):
            inbound["index.html"] += 1
    return inbound


# ---------------------------------------------------------------- main

def main():
    if len(sys.argv) > 1:
        folder = sys.argv[1]
    else:
        # double-clicked: check the folder the script itself is sitting in
        folder = os.path.dirname(os.path.abspath(__file__)) or "."

    files = sorted(glob.glob(os.path.join(folder, "*.html")))
    if not files:
        print(f"No .html files found in {os.path.abspath(folder)}")
        print("Put check-site.py in the same folder as your .html pages, "
              "or run: python check-site.py <folder>")
        return 1

    articles, skipped = [], []
    for f in files:
        html = open(f, encoding="utf-8", errors="replace").read()
        (articles if is_article_page(html) else skipped).append(f)

    for f in articles:
        html = open(f, encoding="utf-8", errors="replace").read()
        name = os.path.basename(f)
        check_wordmark(name, html)
        check_escapes(name, html)
        check_jsonld(name, html)
        check_head(f, html)
        check_images(name, html)

    inbound = check_links(articles, files)

    print(f"\nChecked {len(articles)} article page(s) in {os.path.abspath(folder)}")
    if skipped:
        print(f"{DIM}Skipped {len(skipped)} non-article file(s): "
              f"{', '.join(os.path.basename(s) for s in skipped)}{OFF}")
    print()

    if problems:
        print(f"{RED}{len(problems)} problem(s){OFF}")
        for f, msg in problems:
            print(f"  {RED}{BAD}{OFF} {f}: {msg}")
        print()

    if warnings:
        print(f"{YEL}{len(warnings)} warning(s){OFF}")
        for f, msg in warnings:
            print(f"  {YEL}{WARN}{OFF} {f}: {msg}")
        print()

    if not inbound:
        print("No pages using the article template were found here.")
        return 1 if problems else 0

    orphans = [n for n, c in sorted(inbound.items()) if c == 0]
    if orphans:
        print(f"{YEL}Pages nothing links to{OFF} {DASH} unreachable unless you know the URL:")
        for n in orphans:
            print(f"  {YEL}{WARN}{OFF} {n}")
        print()

    print(f"{DIM}Inbound links (how many pages link to each):{OFF}")
    for n, c in sorted(inbound.items(), key=lambda x: -x[1]):
        bar = BAR * c
        print(f"  {c:>3} {bar:<10} {n}")

    if not problems:
        print(f"\n{GRN}No problems.{OFF}"
              + (f" {len(warnings)} warning(s) worth a look." if warnings else ""))
    return 1 if problems else 0


if __name__ == "__main__":
    # Any crash must be visible. Without this, an unexpected error on a double-click
    # closes the console instantly and the script looks like it "did nothing".
    try:
        code = main()
    except Exception:
        import traceback
        print("\ncheck-site.py hit an unexpected error:\n")
        traceback.print_exc()
        print("\nPlease send the text above to whoever maintains this script.")
        code = 2
    # Double-clicking on Windows runs the script in a console that closes the moment
    # it exits, so the output flashes past unread. If no folder argument was given —
    # which is what a double-click looks like — hold the window open.
    if len(sys.argv) == 1:
        try:
            input("\nPress Enter to close...")
        except (EOFError, KeyboardInterrupt):
            pass
    sys.exit(code)
