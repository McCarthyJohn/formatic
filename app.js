/* Formatic — interview a PDF form, then add the answers to the original.
   The page is never redrawn: pdf-lib copies the source document and draws
   answer text on top, so every original glyph stays exactly where it was. */

(function () {
  'use strict';

  var FORMS = [
    { id: 'sale-onboarding', name: 'Onboarding Form / Sale Instructions', map: 'forms/sale-onboarding/map.json' }
  ];

  var state = {
    form: null, map: null, answers: {}, index: 0, view: 'home',
    pages: null,      // custom forms keep their page images in IndexedDB
    pdfBytes: null
  };

  var $ = function (id) { return document.getElementById(id); };
  var el = function (tag, attrs, kids) {
    var n = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (k === 'class') n.className = attrs[k];
      else if (k === 'text') n.textContent = attrs[k];
      else if (k.slice(0, 2) === 'on') n.addEventListener(k.slice(2), attrs[k]);
      else n.setAttribute(k, attrs[k]);
    });
    (kids || []).forEach(function (c) { if (c) n.appendChild(c); });
    return n;
  };

  function storeKey() { return 'formatic:answers:' + state.form.id; }
  function loadAnswers() {
    try { state.answers = JSON.parse(localStorage.getItem(storeKey()) || '{}') || {}; }
    catch (e) { state.answers = {}; }
  }
  function saveAnswers() {
    try { localStorage.setItem(storeKey(), JSON.stringify(state.answers)); } catch (e) {}
  }

  function answered(field) {
    var v = state.answers[field.key];
    if (v === undefined || v === null) return false;
    if (Array.isArray(v)) return v.length > 0;
    return String(v).trim() !== '';
  }

  function answeredCount() {
    var total = 0, done = 0;
    state.map.questions.forEach(function (q) {
      q.fields.forEach(function (f) { total++; if (answered(f)) done++; });
    });
    return { done: done, total: total };
  }

  /* ---------------- home ---------------- */
  var homeToken = 0;
  function renderHome() {
    var token = ++homeToken;
    state.view = 'home';
    $('home').hidden = false;
    $('interview').hidden = true;
    $('review').hidden = true;
    $('barMid').hidden = true;
    $('downloadBtn').hidden = true;
    $('reviewBtn').hidden = true;

    var list = $('formList');
    list.innerHTML = '';

    function addCard(f, metaText) {
      var meta = el('div', { class: 'meta', text: metaText || 'Loading…' });
      var card = el('button', {
        class: 'form-card',
        onclick: function () { openForm(f); }
      }, [
        el('div', {}, [el('h3', { text: f.name }), meta]),
        el('span', { class: 'badge', text: 'Open' })
      ]);
      list.appendChild(card);
      return meta;
    }

    /* a bundled form only earns a card if its map is actually there */
    FORMS.forEach(function (f) {
      fetch(f.map).then(function (r) {
        if (!r.ok) throw new Error('missing');
        return r.json();
      }).then(function (m) {
        if (token !== homeToken) return;
        var fields = m.questions.reduce(function (n, q) { return n + q.fields.length; }, 0);
        var nq = m.questions.length;
        addCard(f, m.form.source_pages + ' pages · ' + nq +
          (nq === 1 ? ' question · ' : ' questions · ') + fields + ' answers');
        emptyState();
      }).catch(function () { emptyState(); });
    });

    FormaticStore.all().then(function (recs) {
      if (token !== homeToken) return;          // a newer render has taken over
      var seen = {};
      recs.sort(function (a, b) { return (b.createdAt || 0) - (a.createdAt || 0); }).forEach(function (rec) {
        if (seen[rec.id]) return;
        seen[rec.id] = true;
        var fields = rec.map.questions.reduce(function (n, q) { return n + q.fields.length; }, 0);
        var nq = rec.map.questions.length;
        addCard({ id: rec.id, name: rec.name, source: 'custom' },
          rec.map.form.source_pages + ' pages · ' + nq + (nq === 1 ? ' question · ' : ' questions · ') +
          fields + ' answers · yours');
      });
      emptyState();
    }).catch(function () { emptyState(); });

    function emptyState() {
      if (token !== homeToken) return;
      var old = $('homeEmpty');
      if (old) old.remove();
      if (list.children.length) return;
      list.appendChild(el('p', {
        id: 'homeEmpty', class: 'muted',
        text: 'No forms yet. Tap “+ Add a form”, choose a PDF, and Formatic will draft the questions for you to check.'
      }));
    }
  }

  function loadFormData(f) {
    if (f.source === 'custom') {
      return FormaticStore.get(f.id).then(function (rec) {
        if (!rec) throw new Error('That form is no longer in this browser');
        return { map: rec.map, pages: rec.pages, pdfBytes: rec.pdf };
      });
    }
    return fetch(f.map).then(function (r) { return r.json(); })
      .then(function (map) { return { map: map, pages: null, pdfBytes: null }; });
  }

  function openForm(f) {
    state.form = f;
    loadFormData(f).then(function (data) {
      var map = data.map;
      state.pages = data.pages;
      state.pdfBytes = data.pdfBytes;
      state.map = map;
      loadAnswers();
      $('formName').textContent = map.form.name;
      $('barMid').hidden = false;
      $('reviewBtn').hidden = false;
      $('downloadBtn').hidden = false;
      $('home').hidden = true;
      $('interview').hidden = false;
      renderRail();
      showQuestion(firstUnanswered(), true);
    }).catch(function (e) {
      toast('Could not load the form: ' + e.message);
    });
  }

  function firstUnanswered() {
    for (var i = 0; i < state.map.questions.length; i++) {
      var q = state.map.questions[i];
      if (q.fields.some(function (f) { return !answered(f); })) return i;
    }
    return 0;
  }

  /* ---------------- rail ---------------- */
  function renderRail() {
    var rail = $('rail');
    rail.innerHTML = '';
    var seen = {};
    state.map.questions.forEach(function (q, i) {
      var sec = state.map.sections.filter(function (s) { return s.id === q.section; })[0];
      var title = sec ? sec.title : 'General';
      var complete = q.fields.every(answered);
      var letter = q.number || (sec ? (sec.letter || '') : '');
      var label = (q.prompt || q.fields[0].label || title).replace(/\s+/g, ' ');
      var b = el('button', {
        class: 'rail-item' + (i === state.index ? ' active' : '') + (complete ? ' done' : ''),
        title: label,
        onclick: function () { showQuestion(i); }
      }, [
        el('span', { class: 'ltr', text: complete ? '✓' : letter }),
        el('span', { text: label.length > 40 ? label.slice(0, 38) + '…' : label })
      ]);
      rail.appendChild(b);
    });
  }

  /* ---------------- question ---------------- */
  function showQuestion(i, initial) {
    state.index = Math.max(0, Math.min(i, state.map.questions.length - 1));
    var q = state.map.questions[state.index];
    var sec = state.map.sections.filter(function (s) { return s.id === q.section; })[0];

    $('sectionName').textContent = sec ? sec.title : 'Form';
    $('prompt').textContent = q.prompt || q.fields[0].label || 'Question ' + q.number;

    var wrap = $('fields');
    wrap.innerHTML = '';
    q.fields.forEach(function (f) { wrap.appendChild(fieldControl(f)); });

    var c = answeredCount();
    $('count').textContent = c.done + ' of ' + c.total + ' answered';
    $('progress').textContent = 'Question ' + (state.index + 1) + ' of ' + state.map.questions.length;
    $('backBtn').disabled = state.index === 0;
    $('nextBtn').textContent = state.index === state.map.questions.length - 1 ? 'Review' : 'Next';

    renderRail();
    renderPaper(q);
    if (initial) $('prompt').scrollIntoView({ block: 'center' });
  }

  function fieldControl(f) {
    var box = el('div', { class: 'field' });

    if (f.type === 'text') {
      var input = el('textarea', { rows: 2, placeholder: f.placeholder || '' });
      input.value = state.answers[f.key] || '';
      input.addEventListener('input', function () {
        state.answers[f.key] = input.value;
        saveAnswers();
        paintSlots();
        var c = answeredCount();
        $('count').textContent = c.done + ' of ' + c.total + ' answered';
      });
      box.appendChild(el('label', { text: f.label }));
      box.appendChild(input);
      return box;
    }

    var opts = (f.options || []).filter(function (o) { return o.label; });
    if (opts.length === 0) {
      // no usable option labels: fall back to a text answer so nothing is lost
      return fieldControl({ key: f.key, label: f.label, type: 'text' });
    }

    var multi = f.type === 'multi';
    // the prompt already asks the question; a label made by joining every option is noise
    if (f.label && f.label.length < 45) box.appendChild(el('label', { text: f.label }));
    var group = el('div', { class: 'opts' });

    var current = state.answers[f.key];
    opts.forEach(function (o, oi) {
      var on = multi
        ? (Array.isArray(current) && current.indexOf(oi) !== -1)
        : (Number(current) === oi);
      var input = el('input', { type: multi ? 'checkbox' : 'radio', name: f.key });
      input.checked = on;
      var row = el('label', { class: 'opt' + (on ? ' on' : '') }, [input, el('span', { text: o.label })]);
      input.addEventListener('change', function () {
        if (multi) {
          var arr = Array.isArray(state.answers[f.key]) ? state.answers[f.key].slice() : [];
          var at = arr.indexOf(oi);
          if (input.checked && at === -1) arr.push(oi);
          if (!input.checked && at !== -1) arr.splice(at, 1);
          state.answers[f.key] = arr.sort(function (a, b) { return a - b; });
        } else {
          state.answers[f.key] = input.checked ? oi : null;
        }
        Array.prototype.forEach.call(group.children, function (r, ri) {
          r.classList.toggle('on', multi
            ? (Array.isArray(state.answers[f.key]) && state.answers[f.key].indexOf(ri) !== -1)
            : Number(state.answers[f.key]) === ri);
        });
        saveAnswers();
        paintSlots();
        var c = answeredCount();
        $('count').textContent = c.done + ' of ' + c.total + ' answered';
      });
      group.appendChild(row);
    });
    box.appendChild(group);
    return box;
  }

  /* ---------------- paper ---------------- */
  var PAGE_W = 595.32, PAGE_H = 841.92;

  function renderPaper(q) {
    var page = q.page || q.fields[0].page;
    $('pageLabel').textContent = 'Page ' + page + ' of ' + state.map.form.source_pages;
    var img = $('pageImg');
    img.onload = function () { paintSlots(page); };
    img.src = state.pages
      ? state.pages[page - 1].dataUrl
      : 'forms/' + state.form.id + '/pages/p' + ('0' + page).slice(-2) + '.jpg';
    paintSlots(page);
  }

  function paintSlots(page) {
    var q = state.map.questions[state.index];
    var pg = page || (q.page || q.fields[0].page);
    var layer = $('overlay');
    layer.innerHTML = '';
    var img = $('pageImg');
    var scale = (img.clientWidth || 600) / PAGE_W;

    state.map.questions.forEach(function (qq) {
      qq.fields.forEach(function (f) {
        if (f.page !== pg) return;
        var live = qq === q;
        var v = state.answers[f.key];
        if (f.type === 'text') {
          if (!v) return;
          var s = el('div', {
            class: 'slot' + (live ? ' live' : ''),
            text: String(v)
          });
          s.style.left = (f.x * scale) + 'px';
          s.style.top = ((f.y - f.size) * scale) + 'px';
          s.style.width = (f.w * scale) + 'px';
          s.style.fontSize = (f.size * scale) + 'px';
          s.style.lineHeight = '1.1';
          layer.appendChild(s);
        } else {
          if (v === undefined || v === null) return;
          var picks = Array.isArray(v) ? v : [Number(v)];
          picks.forEach(function (pi) {
            var o = (f.options || [])[pi];
            if (!o) return;
            var t = el('div', { class: 'tick', text: '✓' });
            t.style.left = ((o.box.x + 1) * scale) + 'px';
            t.style.top = ((o.box.y - 1) * scale) + 'px';
            t.style.fontSize = (o.box.h * scale * 1.15) + 'px';
            t.style.color = '#16233c';
            t.style.lineHeight = '1';
            layer.appendChild(t);
          });
        }
      });
    });
  }

  window.addEventListener('resize', function () { if (state.map) paintSlots(); });

  /* ---------------- navigation ---------------- */
  function next() {
    if (state.index === state.map.questions.length - 1) return showReview();
    showQuestion(state.index + 1);
  }
  function back() { if (state.index > 0) showQuestion(state.index - 1); }

  /* ---------------- review ---------------- */
  function showReview() {
    state.view = 'review';
    $('interview').hidden = true;
    $('review').hidden = false;
    $('reviewBtn').hidden = true;
    $('downloadBtn').hidden = false;

    var c = answeredCount();
    $('reviewSummary').textContent = c.done + ' of ' + c.total + ' answers filled in. ' +
      (c.done < c.total ? 'Anything left blank stays blank on the PDF.' : 'Everything is answered.');

    var list = $('reviewList');
    list.innerHTML = '';
    state.map.questions.forEach(function (q, i) {
      q.fields.forEach(function (f) {
        var v = state.answers[f.key];
        var shown = Array.isArray(v)
          ? v.map(function (ix) { return (f.options[ix] || {}).label; }).filter(Boolean).join(', ')
          : (f.type === 'text' ? v : ((f.options[Number(v)] || {}).label));
        var row = el('div', { class: 'review-row' }, [
          el('div', {}, [
            el('div', { class: 'q', text: q.number + '. ' + (q.prompt || f.label).slice(0, 70) }),
            el('div', { class: 'a', text: shown || '—' })
          ]),
          el('button', { text: 'Edit', onclick: function () { $('review').hidden = true; $('interview').hidden = false; showQuestion(i); } })
        ]);
        list.appendChild(row);
      });
    });
  }

  /* ---------------- fill ---------------- */
  function download() {
    var getBytes = state.pdfBytes
      ? Promise.resolve(state.pdfBytes.slice(0))
      : fetch('forms/' + state.form.id + '/source.pdf').then(function (r) { return r.arrayBuffer(); });

    getBytes.then(function (buf) {
      return PDFLib.PDFDocument.load(buf, { ignoreEncryption: true });
    }).then(function (doc) {
      var font = doc.embedStandardFont(PDFLib.StandardFonts.Helvetica);
      var pages = doc.getPages();

      state.map.questions.forEach(function (q) {
        q.fields.forEach(function (f) {
          var v = state.answers[f.key];
          if (v === undefined || v === null || v === '' ) return;
          var page = pages[f.page - 1];
          if (!page) return;

          if (f.type === 'text') drawText(page, font, f, String(v));
          else {
            var picks = Array.isArray(v) ? v : [Number(v)];
            picks.forEach(function (pi) {
              var o = (f.options || [])[pi];
              if (o) drawTick(page, o.box);
            });
          }
        });
      });

      return doc.save();
    }).then(function (bytes) {
      var blob = new Blob([bytes], { type: 'application/pdf' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = state.form.id + '-completed.pdf';
      document.body.appendChild(a);
      a.click();
      setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 4000);
      toast('Downloaded — the original pages are untouched.');
    }).catch(function (e) {
      console.error(e);
      toast('Could not build the PDF: ' + e.message);
    });
  }

  function drawText(page, font, f, text) {
    // shrink to fit the slot; wrap only if the slot is genuinely too narrow
    var size = f.size || 9;
    var w = font.widthOfTextAtSize(text, size);
    while (w > f.w && size > 6.2) {
      size -= 0.4;
      w = font.widthOfTextAtSize(text, size);
    }
    var y = PAGE_H - f.y;
    if (w <= f.w || f.w < 40) {
      page.drawText(text, { x: f.x, y: y, size: size, font: font, color: PDFLib.rgb(0.06, 0.11, 0.22) });
      return;
    }
    // wrap at 8pt, up to three lines inside the row
    var words = text.split(/\s+/), lines = [], line = '';
    words.forEach(function (word) {
      var test = line ? line + ' ' + word : word;
      if (font.widthOfTextAtSize(test, 8) > f.w && line) { lines.push(line); line = word; }
      else line = test;
    });
    if (line) lines.push(line);
    lines.slice(0, 3).forEach(function (ln, i) {
      page.drawText(ln, { x: f.x, y: y + (i * 9), size: 8, font: font, color: PDFLib.rgb(0.06, 0.11, 0.22) });
    });
  }

  function drawTick(page, box) {
    // box coords are top-down; convert to PDF space
    var x = box.x, top = PAGE_H - box.y, bottom = top - box.h;
    var p1 = { x: x + 2.0, y: bottom + 4.6 };
    var p2 = { x: x + 5.0, y: bottom + 1.8 };
    var p3 = { x: x + 10.0, y: bottom + 10.4 };
    page.drawLine({ start: p1, end: p2, thickness: 1.4, color: PDFLib.rgb(0.06, 0.11, 0.22) });
    page.drawLine({ start: p2, end: p3, thickness: 1.4, color: PDFLib.rgb(0.06, 0.11, 0.22) });
  }

  /* ---------------- misc ---------------- */
  var toastTimer;
  function toast(msg) {
    var t = $('toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.hidden = true; }, 3200);
  }

  $('homeBtn').addEventListener('click', function () {
    if (state.map && state.view !== 'home') {
      state.map = null; state.pages = null; state.pdfBytes = null;
      renderHome();
    }
  });
  $('nextBtn').addEventListener('click', next);
  $('backBtn').addEventListener('click', back);
  $('downloadBtn').addEventListener('click', download);
  $('reviewBtn').addEventListener('click', showReview);
  $('backToInterview').addEventListener('click', function () {
    $('review').hidden = true; $('interview').hidden = false; showQuestion(state.index);
  });
  $('reviewDownload').addEventListener('click', download);
  $('zoomBtn').addEventListener('click', function () {
    var sheet = $('sheet');
    sheet.style.maxWidth = sheet.style.maxWidth === 'none' ? '720px' : 'none';
  });

  window.FormaticApp = {
    refreshHome: function () { if (!state.map) renderHome(); }
  };

  $('addFormBtn').addEventListener('click', function () {
    if (window.FormaticMapper) FormaticMapper.open();
    else toast('The mapper did not load.');
  });

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(function () {});
  }

  renderHome();
})();
