/* puzzle.js — self-contained chess puzzles for the reading pages.

   Two goals:

     mate (default) — find the mate in one. Any mating move is accepted, because several
       positions have two and rejecting a genuine checkmate would be wrong. Verified live
       with chess.js's in_checkmate(), so no answer needs to be stored.

     win material   — take the hanging piece. Set data-goal="win" and provide the accepted
       move(s) in data-solution as from+to, comma-separated. chess.js has no "this wins
       material" primitive, so the winning move set is computed OFFLINE against the real
       game (best recapture still leaves you up a piece) and baked in here — the widget
       only checks the played move against that verified set.

     <div class="puzzle" data-fen="…" data-note="You played Qc6 here."></div>
     <div class="puzzle" data-goal="win" data-fen="…" data-solution="a3c5"
          data-win="a bishop" data-note="…"></div>
     <script src="https://cdnjs.cloudflare.com/ajax/libs/chess.js/0.10.3/chess.min.js"></script>
     <script src="/puzzle.js" defer></script>

   The piece paths and square colours are duplicated from app.html on purpose: an article
   is a standalone page that must not depend on an 900KB app, and these have not changed
   since the app shipped. If the board ever gets restyled, both need updating. */
(function () {
  "use strict";

  var PIECE = {
    p: {d: "M 22.5 8.8 A 4.4 4.4 0 0 0 19.4 16.3 C 17.4 17.5 16.2 19.6 16.2 21.9 C 16.2 23.9 17.1 25.6 18.5 26.7 C 15.4 28.1 12.8 31.6 12.8 37 L 32.2 37 C 32.2 31.6 29.6 28.1 26.5 26.7 C 27.9 25.6 28.8 23.9 28.8 21.9 C 28.8 19.6 27.6 17.5 25.6 16.3 A 4.4 4.4 0 0 0 22.5 8.8 Z"},
    r: {d: "M 11.8 37 L 33.2 37 L 33.2 33.8 L 30.6 31.4 L 30.6 29.8 L 28.6 27.6 L 28.6 16.4 L 30.6 14.4 L 30.6 8.8 L 26.9 8.8 L 26.9 11.6 L 24.4 11.6 L 24.4 8.8 L 20.6 8.8 L 20.6 11.6 L 18.1 11.6 L 18.1 8.8 L 14.4 8.8 L 14.4 14.4 L 16.4 16.4 L 16.4 27.6 L 14.4 29.8 L 14.4 31.4 L 11.8 33.8 Z",
        d2: "M 16.4 27.6 L 28.6 27.6 M 16.4 16.4 L 28.6 16.4"},
    n: {d: "M 13.5 37 C 13.5 30.5 15.5 26 19.5 23.2 L 15.5 21.8 C 13.6 21.8 11.5 21.7 9.6 21.2 L 8.2 20.5 C 7.9 19.7 8.2 18.8 9.2 18.4 C 8.5 17.6 8.7 16.5 9.7 16.1 C 12.6 14.3 16.1 12.4 18.8 11.6 L 19.6 7.8 L 22.4 10.9 L 24.2 8.4 L 25.4 11.6 C 30.5 13.2 34 18.5 34.5 25.5 C 34.9 30 34.6 34 34.4 37 Z",
        d2: "M 16.9 16 A 1 1 0 1 1 16.88 16 M 8.9 20.1 L 11.4 19.3 M 26 14.4 C 29.6 17.4 31.6 21.6 32.2 26.6"},
    b: {d: "M 22.5 6.2 A 2.2 2.2 0 1 1 22.48 6.2 Z M 22.5 10.8 C 18.2 13.6 15.9 17.6 15.9 21.4 C 15.9 24.2 17.3 26.4 19.4 27.6 L 25.6 27.6 C 27.7 26.4 29.1 24.2 29.1 21.4 C 29.1 17.6 26.8 13.6 22.5 10.8 Z M 17.9 29.4 L 27.1 29.4 L 28 31.4 L 17 31.4 Z M 13.2 37 C 13.2 34.6 16.4 33.2 22.5 33.2 C 28.6 33.2 31.8 34.6 31.8 37 Z",
        d2: "M 22.5 14.6 L 22.5 22.6 M 19.1 18.6 L 25.9 18.6"},
    q: {d: "M 11.4 12.6 A 1.8 1.8 0 1 1 11.38 12.6 Z M 22.5 8 A 1.8 1.8 0 1 1 22.48 8 Z M 33.6 12.6 A 1.8 1.8 0 1 1 33.58 12.6 Z M 16.9 10.4 A 1.8 1.8 0 1 1 16.88 10.4 Z M 28.1 10.4 A 1.8 1.8 0 1 1 28.08 10.4 Z M 14.9 30.2 L 11.6 15.8 L 16.5 21.6 L 19.4 13.2 L 22.5 20.4 L 25.6 13.2 L 28.5 21.6 L 33.4 15.8 L 30.1 30.2 Z M 14.2 32 L 30.8 32 C 31.8 33.4 32.6 35.2 32.8 37 L 12.2 37 C 12.4 35.2 13.2 33.4 14.2 32 Z"},
    k: {d: "M 21.2 6 L 23.8 6 L 23.8 9 L 26.6 9 L 26.6 11.6 L 23.8 11.6 L 23.8 14.6 L 21.2 14.6 L 21.2 11.6 L 18.4 11.6 L 18.4 9 L 21.2 9 Z M 22.5 16.4 C 26.4 12.8 33 14.8 32.8 20.2 C 32.7 24 29.2 27 27.4 30 L 17.6 30 C 15.8 27 12.3 24 12.2 20.2 C 12 14.8 18.6 12.8 22.5 16.4 Z M 14.2 32 L 30.8 32 C 31.8 33.4 32.6 35.2 32.8 37 L 12.2 37 C 12.4 35.2 13.2 33.4 14.2 32 Z",
        d2: "M 22.5 17 L 22.5 29"}
  };
  var FILES = "abcdefgh";

  var CSS = [
    ".pz{margin:22px 0;padding:14px;background:#161719;border:1px solid #313436}",
    ".pz-wrap{position:relative;width:100%;max-width:352px;margin:0 auto}",
    ".pz-arrow{position:absolute;inset:0;width:100%;height:100%;pointer-events:none}",
    // grid-template-ROWS matters as much as columns: without it the rows size to their
    // content, so a rank with no pieces on it collapses and the board renders seven rows
    // deep. Every other board on the site states both.
    ".pz-board{display:grid;grid-template-columns:repeat(8,1fr);grid-template-rows:repeat(8,1fr);",
    "  width:100%;aspect-ratio:1;user-select:none;-webkit-user-select:none;",
    "  -webkit-tap-highlight-color:transparent}",
    ".pz-sq{position:relative;display:flex;align-items:center;justify-content:center;cursor:pointer}",
    ".pz-sq.l{background:#B9BCB0}.pz-sq.d{background:#6E7A68}",
    ".pz-sq svg{width:88%;height:88%;display:block;pointer-events:none}",
    ".pz-sq.pick::after{content:'';position:absolute;inset:0;box-shadow:inset 0 0 0 3px #D3B25A;",
    "  background:rgba(211,178,90,.18)}",
    ".pz-sq.hit::after{content:'';position:absolute;inset:0;box-shadow:inset 0 0 0 3px #6FA47B}",
    ".pz-ask{text-align:center;color:#E7DFC4;font-size:13.5px;margin:12px 0 3px}",
    // min-heights below reserve the space that solving removes — the button row vanishes
    // and the hint blanks, which otherwise shrinks the bordered box and shifts the border.
    ".pz-hint,.pz-note{text-align:center;color:#6A675B;font-size:11.5px;line-height:1.75;margin:0 0 4px;min-height:20px}",
    ".pz-fb{text-align:center;font-size:13px;min-height:22px;margin:8px 0 4px}",
    ".pz-fb.ok{color:#6FA47B}.pz-fb.no{color:#E0776C}",
    ".pz-act{text-align:center;min-height:30px}",
    ".pz-act button{font-family:inherit;font-size:12px;color:#6FA47B;background:none;",
    "  border:1px solid #6FA47B;padding:7px 14px;cursor:pointer}",
    ".pz-act button:hover{background:rgba(111,164,123,.1)}"
  ].join("");

  function svgFor(ch) {
    var white = ch === ch.toUpperCase();
    var fill = white ? "#F8F7F2" : "#4A4B4D", line = white ? "#4E4F51" : "#1B1C1E";
    var p = PIECE[ch.toLowerCase()];
    var s = '<path d="' + p.d + '" fill="' + fill + '" stroke="' + line + '" stroke-width="1.6" stroke-linejoin="round"/>';
    if (p.d2) s += '<path d="' + p.d2 + '" fill="none" stroke="' + line + '" stroke-width="1.5" stroke-linecap="round"/>';
    return '<svg viewBox="0 0 45 45" aria-hidden="true">' + s + "</svg>";
  }

  // squares in display order, flipped so the side to move is always at the bottom
  function squares(fen, flip) {
    var rows = fen.split(" ")[0].split("/"), cells = [];
    rows.forEach(function (row, r) {
      var f = 0;
      row.split("").forEach(function (ch) {
        if (/\d/.test(ch)) { for (var k = 0; k < +ch; k++) cells.push({r: r, f: f++, p: null}); }
        else cells.push({r: r, f: f++, p: ch});
      });
    });
    cells.forEach(function (c) { c.sq = FILES[c.f] + (8 - c.r); });
    return flip ? cells.reverse() : cells;
  }


  /* The solved move gets an arrow, matching every other board on the site. Geometry is
     the app's: a 384-unit viewBox over 8 files, so 48 per square and centres at 24+48i.
     The line stops short of the target square so the head lands on it rather than past it.
     Marker ids are per-puzzle — two puzzles on one page sharing an id would leave the
     second one's arrow headless. */
  var arrowSeq = 0;
  function arrowSVG(from, to, flip) {
    var S = 48, SIZE = S * 8, id = "pzmk" + (++arrowSeq);
    var pt = function (n) {
      var f = FILES.indexOf(n[0]), r = 8 - parseInt(n[1], 10);
      return [(flip ? 7 - f : f) * S + S / 2, (flip ? 7 - r : r) * S + S / 2];
    };
    var a = pt(from), b = pt(to);
    var ang = Math.atan2(b[1] - a[1], b[0] - a[0]), back = S * 0.34;
    var ex = b[0] - Math.cos(ang) * back, ey = b[1] - Math.sin(ang) * back;
    var line = 'x1="' + a[0] + '" y1="' + a[1] + '" x2="' + ex.toFixed(1) + '" y2="' + ey.toFixed(1) + '"';
    return '<svg class="pz-arrow" viewBox="0 0 ' + SIZE + " " + SIZE + '" preserveAspectRatio="xMinYMin meet">' +
      '<defs><marker id="' + id + '" markerWidth="3.2" markerHeight="3.2" refX="1.7" refY="1.6" orient="auto">' +
      '<path d="M0,0 L3.2,1.6 L0,3.2 z" fill="#7CC287"/></marker></defs>' +
      '<line ' + line + ' stroke="#0E0F10" stroke-width="9" stroke-linecap="round" opacity="0.35"/>' +
      '<line ' + line + ' stroke="#7CC287" stroke-width="6" stroke-linecap="round" opacity="0.95" ' +
      'marker-end="url(#' + id + ')"/></svg>';
  }

  function build(el) {
    var fen = el.getAttribute("data-fen");
    if (!fen || typeof Chess === "undefined") return;
    var game = new Chess(fen);
    var mover = game.turn() === "w" ? "White" : "Black";
    var flip = game.turn() === "b";
    var note = el.getAttribute("data-note") || "";
    var goal = el.getAttribute("data-goal") === "win" ? "win" : "mate";
    var solset = (el.getAttribute("data-solution") || "").split(",").map(function (s) { return s.trim(); }).filter(Boolean);
    var winText = el.getAttribute("data-win") || "material";
    var state = {sel: null, done: false};

    // data-ask overrides the prompt — a fork puzzle isn't "a piece is hanging, take it".
    var ask = el.getAttribute("data-ask") ||
      (goal === "win"
        ? mover + " to play — a piece is hanging. Take it."
        : mover + " to play — mate in one.");

    // A move solves the puzzle if it mates (checked live) or, in win mode, matches one of
    // the offline-verified winning captures. Promotions are tried so an underpromotion
    // answer isn't rejected for defaulting to a queen.
    function check(from, to) {
      var promos = [undefined, "q", "r", "b", "n"], legal = false, san = null, solved = false;
      for (var i = 0; i < promos.length; i++) {
        try {
          var c = new Chess(fen);
          var mv = c.move(promos[i] ? {from: from, to: to, promotion: promos[i]} : {from: from, to: to});
          if (!mv) continue;
          legal = true; san = mv.san;
          if (goal === "win" ? solset.indexOf(from + to) >= 0 : c.in_checkmate()) { solved = true; break; }
        } catch (e) {}
      }
      return {legal: legal, san: san, solved: solved};
    }

    el.className = "pz";
    el.innerHTML =
      '<div class="pz-wrap"><div class="pz-board"></div></div>' +
      '<div class="pz-ask"><b>' + ask + "</b></div>" +
      '<div class="pz-hint">Click a piece, then its square.</div>' +
      '<div class="pz-fb">&nbsp;</div>' +
      '<div class="pz-act"><button type="button">Show me</button></div>';

    var board = el.querySelector(".pz-board");
    var fb = el.querySelector(".pz-fb");
    var hint = el.querySelector(".pz-hint");
    var btn = el.querySelector(".pz-act button");

    board.innerHTML = squares(fen, flip).map(function (c) {
      var dark = (c.r + c.f) % 2 === 1;
      return '<div class="pz-sq ' + (dark ? "d" : "l") + '" data-sq="' + c.sq + '">' +
             (c.p ? svgFor(c.p) : "") + "</div>";
    }).join("");

    // A note replaces the hint on solve, and a two-line note is taller than the one-line
    // instruction — which would grow the box and shift the border. Reserve the note's exact
    // height now (measured with it briefly in place) so solving never changes the height.
    if (note) {
      var savedHint = hint.innerHTML;
      hint.textContent = note;
      hint.style.minHeight = Math.ceil(hint.getBoundingClientRect().height) + "px";
      hint.innerHTML = savedHint;
    }

    function finish(san, mine, from, to) {
      state.done = true;
      hint.textContent = note;
      fb.className = "pz-fb ok";
      fb.innerHTML = mine
        ? "That's it — " + san + (goal === "win" ? " wins " + winText : "")
        : san + (goal === "win" ? " wins " + winText : " was the move") + ".";
      if (btn.parentNode) btn.parentNode.removeChild(btn);
      // the arrow says it better than two ringed squares
      board.querySelectorAll(".pick,.hit").forEach(function (n) { n.classList.remove("pick", "hit"); });
      el.querySelector(".pz-wrap").insertAdjacentHTML("beforeend", arrowSVG(from, to, flip));
    }

    board.addEventListener("click", function (e) {
      if (state.done) return;
      var cell = e.target.closest ? e.target.closest(".pz-sq") : null;
      if (!cell) return;
      var sq = cell.getAttribute("data-sq");
      if (!state.sel) {
        if (!cell.querySelector("svg")) return;
        state.sel = sq;
        board.querySelectorAll(".pick").forEach(function (n) { n.classList.remove("pick"); });
        cell.classList.add("pick");
        return;
      }
      if (state.sel === sq) { state.sel = null; cell.classList.remove("pick"); return; }
      var res = check(state.sel, sq);
      if (res.solved) {
        finish(res.san, true, state.sel, sq);
        state.sel = null;
      } else if (res.legal) {
        fb.className = "pz-fb no";
        fb.textContent = goal === "win"
          ? "Legal, but not the winning move. Try again."
          : "Legal, but not mate. Try again.";
        board.querySelectorAll(".pick").forEach(function (n) { n.classList.remove("pick"); });
        state.sel = null;
      } else if (cell.querySelector("svg")) {
        board.querySelectorAll(".pick").forEach(function (n) { n.classList.remove("pick"); });
        cell.classList.add("pick");
        state.sel = sq;
      } else {
        state.sel = null;
        board.querySelectorAll(".pick").forEach(function (n) { n.classList.remove("pick"); });
      }
    });

    btn.addEventListener("click", function () {
      if (goal === "win") {
        var s = solset[0]; if (!s) return;
        var from = s.slice(0, 2), to = s.slice(2, 4);
        var c = new Chess(fen), mv = c.move({from: from, to: to, promotion: "q"});
        finish(mv ? mv.san : s, false, from, to);
        return;
      }
      var mates = game.moves({verbose: true}).filter(function (mv) {
        var t = new Chess(fen); t.move(mv.san); return t.in_checkmate();
      });
      if (!mates.length) return;
      finish(mates[0].san, false, mates[0].from, mates[0].to);
    });
  }

  function init() {
    var els = document.querySelectorAll(".puzzle[data-fen]");
    if (!els.length) return;
    var style = document.createElement("style");
    style.textContent = CSS;
    document.head.appendChild(style);
    els.forEach(build);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
