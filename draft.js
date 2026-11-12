/* Auto-draft: turn a rendered PDF's own text into a first-pass map.
   Heuristics are deliberately conservative — a wrong slot is worse than a missing one,
   because the reviewer only has to add what is absent but must notice what is misfiled. */
(function () {
  'use strict';

  var CHECK = /[\uF06F\uF0A8\u2610\u25A1\u25A0]/;      // Wingdings boxes and Unicode squares
  var DOTS = /^[.\u00B7\u2026]{3,}$/;                  // dotted leader run
  var UNDER = /^_{4,}$/;                               // writing line

  function round(n) { return Math.round(n * 10) / 10; }

  function tokensFrom(items, H) {
    var out = [];
    (items || []).forEach(function (it) {
      if (!it.str || !it.str.trim()) return;
      var tx = it.transform || [1, 0, 0, 1, 0, 0];
      var size = Math.hypot(tx[2], tx[3]) || it.height || 9;
      var base = H - tx[5];
      var width = it.width || 0;
      var str = it.str;
      var per = width / Math.max(1, str.length);
      var re = /\S+/g, m;
      while ((m = re.exec(str))) {
        out.push({
          text: m[0],
          x: tx[4] + m.index * per,
          x2: tx[4] + (m.index + m[0].length) * per,
          y: base,
          size: size,
          w: m[0].length * per
        });
      }
    });
    out.sort(function (a, b) { return (b.y - a.y) || (a.x - b.x); });
    return out;
  }

  function rowsOf(tokens) {
    var rows = [], cur = null;
    tokens.forEach(function (t) {
      if (!cur || Math.abs(cur.y - t.y) > 3.2) {
        cur = { y: t.y, size: t.size, items: [] };
        rows.push(cur);
      }
      cur.items.push(t);
      cur.size = Math.max(cur.size, t.size);
    });
    rows.forEach(function (r) {
      r.items.sort(function (a, b) { return a.x - b.x; });
      r.text = r.items.map(function (i) { return i.text; }).join(' ').replace(/\s+/g, ' ').trim();
    });
    return rows;
  }

  function cleanLabel(s) {
    return (s || '')
      .replace(/\s*[:\u2026.\u00B7_]{2,}\s*$/, '')
      .replace(/\s*[:\-]\s*$/, '')
      .replace(/\(\s*\)/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function isHeading(row) {
    if (row.size < 11.4) return false;
    var letters = row.text.replace(/[^A-Za-z]/g, '');
    if (letters.length < 5) return false;
    return letters.replace(/[^A-Z]/g, '').length / letters.length > 0.65;
  }

  /* merged writing runs on a row: dotted leaders and underscore lines */
  function runsOn(row) {
    var runs = [], cur = null;
    row.items.forEach(function (t) {
      if (!DOTS.test(t.text) && !UNDER.test(t.text)) { cur = null; return; }
      if (cur && t.x - cur.x2 < 4 && Math.abs(t.size - cur.size) < 1.5) {
        cur.x2 = t.x2;
      } else {
        cur = { x: t.x, x2: t.x2, size: t.size, y: t.y };
        runs.push(cur);
      }
    });
    return runs.filter(function (r) { return (r.x2 - r.x) > 28; });
  }

  /* label text sitting between two x coordinates on the same row */
  function textBetween(row, x1, x2, skipCheck) {
    return cleanLabel(row.items.filter(function (t) {
      return t.x >= x1 - 2 && t.x2 <= x2 + 2 && !DOTS.test(t.text) && !UNDER.test(t.text) &&
        !(skipCheck && CHECK.test(t.text));
    }).map(function (t) { return t.text; }).join(' '));
  }

  function draftPage(page, H, pageNo) {
    return page.getTextContent().then(function (tc) {
      var rows = rowsOf(tokensFrom(tc.items, H));
      var items = [];
      var context = '';            // most recent sentence on the page, used as a fallback prompt

      rows.forEach(function (row) {
        if (!row.text) return;
        if (row.y < 45 || row.y > H - 45) return;        // page furniture: headers and footers

        if (isHeading(row)) {
          items.push({ kind: 'section', title: row.text.slice(0, 70), page: pageNo });
          context = '';
          return;
        }

        /* ---- checkboxes ---- */
        var boxes = row.items.filter(function (t) { return CHECK.test(t.text); });
        if (boxes.length) {
          var opts = [];
          boxes.forEach(function (b, i) {
            var next = boxes[i + 1];
            var limit = next ? next.x : Math.min(b.x + 230, 560);
            var label = textBetween(row, b.x2 - 1, limit, true);
            opts.push({
              label: (label || 'Option ' + (i + 1)).slice(0, 60),
              box: {
                x: round(b.x - b.size * 0.15),
                y: round(b.y - b.size * 0.85),
                w: round(b.size * 1.15),
                h: round(b.size * 1.15)
              }
            });
          });
          var qLabel = textBetween(row, 0, boxes[0].x, true) || context;
          if (!qLabel) return;                       // no idea what this row asks: leave it to the reviewer
          items.push({ kind: 'choice', prompt: qLabel.slice(0, 90), page: pageNo, options: opts });
          if (!textBetween(row, 0, boxes[0].x, true)) context = qLabel;
          return;
        }

        /* ---- writing lines ---- */
        var runs = runsOn(row);
        if (runs.length) {
          var fields = [], prevEnd = 0, labels = [];
          runs.forEach(function (r) {
            var label = textBetween(row, prevEnd, r.x, false);
            labels.push(label);
            fields.push({
              label: label,
              x: round(r.x + 1),
              y: round(r.y - 0.5),
              w: round(Math.min(Math.max(r.x2 - r.x, 45), 320)),
              size: Math.min(9, Math.round(r.size * 10) / 10 || 9)
            });
            prevEnd = r.x2;
          });

          var named = labels.filter(function (l) { return l.length > 1; });
          var prompt = named.length > 1 ? named.join(' · ') : (named[0] || context || '');
          /* prose that merely contains dots is not a field label */
          if (!named.length) return;
          if (prompt.length > 80 || named.join(' ').split(' ').length > 9) return;

          items.push({ kind: 'text', prompt: prompt.slice(0, 90), page: pageNo, fields: fields });
          return;
        }

        /* ---- standing text: remembered as context for the rows that follow ---- */
        if (row.size >= 8.5 && row.text.length >= 3) {
          var c = cleanLabel(row.text);
          if (c.length <= 120) context = c;
        }
      });

      return items;
    });
  }

  function draft(doc) {
    var all = [];
    var i = 1;
    function next() {
      if (i > doc.numPages) return Promise.resolve(all);
      var n = i;
      return doc.getPage(n).then(function (p) {
        var H = p.getViewport({ scale: 1 }).height;
        return draftPage(p, H, n).then(function (items) {
          items.forEach(function (it) { it.page = n; it._order = all.length; });
          all = all.concat(items);
          i++;
          return next();
        });
      });
    }
    return next();
  }

  window.FormaticDraft = { draft: draft };
})();
