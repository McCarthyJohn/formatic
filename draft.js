/* Auto-draft: turn a rendered PDF's own text into a first-pass map.

   Legal forms are structured, not free-form: a numbered question in a left-hand column and
   its answers in a right-hand column, with the controls often sitting a couple of points
   above or below the text baseline. Drafting row-by-row therefore labels questions wrongly.

   So the unit of work is the QUESTION BLOCK: each numbered item opens a vertical band that
   runs until the next number, and every control inside that band belongs to it. The prompt
   is the form's own wording from that band, so the interview reads like the form. */
(function () {
  'use strict';

  var CHECK = /[\uF06F\uF0A8\u2610\u25A1\u25A0]/;      // Wingdings boxes and Unicode squares
  var DOTS = /^[.\u00B7\u2026]{3,}$/;                  // dotted leader run
  var UNDER = /^_{4,}$/;                               // writing line
  var NUM = /^\d{1,2}[.)]?$/;                          // a question number standing alone

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
          size: size
        });
      }
    });
    out.sort(function (a, b) { return (a.y - b.y) || (a.x - b.x); });
    return out;
  }

  function clean(s) {
    return (s || '')
      .replace(/\s*[:\u2026.\u00B7_]{2,}\s*$/, '')
      .replace(/\s*[:\-]\s*$/, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /* the form's wording, without a trailing section heading and without running on forever */
  function tidyPrompt(s) {
    var t = clean(s);
    t = t.replace(/\s+(?:[A-Z][A-Z0-9&\/\-]+\s+){1,}[A-Z][A-Z0-9&\/\-]+$/, '');
    if (t.length > 110) {
      t = t.slice(0, 110);
      t = t.replace(/\s+\S*$/, '') + '…';
    }
    return t;
  }

  function groupRows(tokens) {
    var rows = [], cur = null;
    tokens.forEach(function (t) {
      if (!cur || Math.abs(cur.y - t.y) > 3) { cur = { y: t.y, items: [] }; rows.push(cur); }
      cur.items.push(t);
    });
    rows.forEach(function (r) { r.items.sort(function (a, b) { return a.x - b.x; }); });
    return rows;
  }

  /* writing runs on one row, merged across adjacent dot tokens */
  function runsOn(tokens) {
    var runs = [], cur = null;
    tokens.forEach(function (t) {
      if (!DOTS.test(t.text) && !UNDER.test(t.text)) { cur = null; return; }
      if (cur && t.x - cur.x2 < 4) { cur.x2 = t.x2; }
      else { cur = { x: t.x, x2: t.x2, y: t.y, size: t.size }; runs.push(cur); }
    });
    return runs.filter(function (r) { return (r.x2 - r.x) > 26; });
  }

  var LEADER = /^[.\u00B7\u2026]+$/;                  // any run of dots is a leader, never a label

  function textBetween(tokens, x1, x2) {
    return clean(tokens.filter(function (t) {
      return t.x >= x1 - 2 && t.x2 <= x2 + 2 &&
        !LEADER.test(t.text) && !DOTS.test(t.text) && !UNDER.test(t.text);
    }).map(function (t) { return t.text; }).join(' '));
  }

  function boxesOn(row) {
    return row.items.filter(function (t) { return CHECK.test(t.text); });
  }

  function optionsFrom(row, boxes) {
    return boxes.map(function (b, i) {
      var next = boxes[i + 1];
      var limit = next ? next.x : Math.min(b.x + 230, 570);
      return {
        label: (textBetween(row.items, b.x2 - 1, limit) || 'Option ' + (i + 1)).slice(0, 60),
        box: {
          x: round(b.x - b.size * 0.15), y: round(b.y - b.size * 0.85),
          w: round(b.size * 1.15), h: round(b.size * 1.15)
        }
      };
    });
  }

  function fieldsFrom(row) {
    var out = [], prevEnd = 0;
    runsOn(row.items).forEach(function (r) {
      var label = textBetween(row.items, prevEnd, r.x);
      if (!label) {
        var left = row.items.filter(function (t) { return t.x2 <= r.x + 1 && !LEADER.test(t.text); });
        if (left.length) label = clean(left[left.length - 1].text);
      }
      out.push({
        label: label,
        x: round(r.x + 1), y: round(r.y),          // r.y is already the baseline
        w: round(Math.min(Math.max(r.x2 - r.x, 45), 320)), size: 9
      });
      prevEnd = r.x2;
    });
    return out;
  }

  function draftPage(page, H, pageNo) {
    return page.getTextContent().then(function (tc) {
      var tokens = tokensFrom(tc.items, H).filter(function (t) {
        return t.y > 42 && t.y < H - 42;             // drop headers and footers
      });
      if (!tokens.length) return [];

      var rows = groupRows(tokens);
      var items = [];

      /* question numbers: small type, hard left */
      var marks = tokens.filter(function (t) {
        return NUM.test(t.text) && t.size <= 9.6 && t.x < 48;
      }).map(function (t) { return { n: t.text.replace(/\D/g, ''), y: t.y }; })
        .sort(function (a, b) { return a.y - b.y; });

      /* sections: larger type on the left, e.g. "A – PROPERTY DETAILS" */
      var headings = rows.filter(function (r) {
        var first = r.items[0];
        return first && first.size >= 11.2 && first.x < 70;
      }).map(function (r) {
        return { y: r.y, title: r.items.map(function (i) { return i.text; }).join(' ').slice(0, 70) };
      });

      function sectionFor(y) {
        var s = null;
        headings.forEach(function (h) { if (h.y <= y + 2) s = h.title; });
        return s;
      }

      /* ---- numbered question blocks ---- */
      marks.forEach(function (m, i) {
        var top = m.y - 7;
        var bottom = i + 1 < marks.length ? marks[i + 1].y - 7 : H;
        var band = tokens.filter(function (t) { return t.y >= top && t.y < bottom; });

        /* the form's own wording, left column only */
        var prompt = tidyPrompt(band.filter(function (t) {
          return t.x > 50 && t.x < 236 && !CHECK.test(t.text) && !DOTS.test(t.text) && !UNDER.test(t.text);
        }).map(function (t) { return t.text; }).join(' '));

        var fields = [], opts = [];
        groupRows(band).forEach(function (row) {
          var boxes = boxesOn(row);
          if (boxes.length) { opts = opts.concat(optionsFrom(row, boxes)); return; }
          fields = fields.concat(fieldsFrom(row));
        });

        if (!fields.length && !opts.length) return;
        items.push({
          kind: fields.length ? 'text' : 'choice',
          prompt: prompt || ('Question ' + m.n),
          number: m.n, page: pageNo, section: sectionFor(m.y),
          fields: fields, options: opts
        });
      });

      /* ---- above the first number: the client's own details ---- */
      var firstMark = marks.length ? marks[0].y - 7 : H;
      var preFields = [], preOpts = [];
      groupRows(tokens.filter(function (t) { return t.y < firstMark; })).forEach(function (row) {
        var boxes = boxesOn(row);
        if (boxes.length) { preOpts = preOpts.concat(optionsFrom(row, boxes)); return; }
        preFields = preFields.concat(fieldsFrom(row));
      });
      if (preFields.length || preOpts.length) {
        items.unshift({
          kind: preFields.length ? 'text' : 'choice',
          prompt: 'Your details', number: '', page: pageNo, section: sectionFor(0),
          fields: preFields, options: preOpts
        });
      }

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
          items.forEach(function (it) { it.page = n; });
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
