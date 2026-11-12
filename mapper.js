/* Formatic mapper — upload a PDF and mark where the answers go.
   Coordinates are stored in PDF points, top-down, same as the bundled map. */
(function () {
  'use strict';

  var pdfjsLib = window.pdfjsLib;
  if (pdfjsLib) pdfjsLib.GlobalWorkerOptions.workerSrc = 'lib/pdf.worker.min.js';

  var S = {
    pdf: null,            // ArrayBuffer
    doc: null,            // pdfjs document
    pages: [],            // [{dataUrl, w, h}]
    page: 1,
    scale: 1.5,
    mode: 'text',
    map: null,
    currentQ: null,
    fileInput: null
  };

  var $ = function (id) { return document.getElementById(id); };
  var el = function (tag, attrs, kids) {
    var n = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (k === 'class') n.className = attrs[k];
      else if (k === 'text') n.textContent = attrs[k];
      else if (k.slice(0, 2) === 'on') n.addEventListener(k.slice(2), attrs[k]);
      else if (k === 'value') n.value = attrs[k];
      else n.setAttribute(k, attrs[k]);
    });
    (kids || []).forEach(function (c) { if (c) n.appendChild(c); });
    return n;
  };

  function slug(s) {
    return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'form';
  }

  /* ---------------- opening ---------------- */
  function open() {
    $('home').hidden = true;
    $('interview').hidden = true;
    $('review').hidden = true;
    $('mapper').hidden = false;
    $('mapName').value = '';
    resetMap();
    if (!S.fileInput) {
      S.fileInput = el('input', { type: 'file', accept: 'application/pdf' });
      S.fileInput.style.display = 'none';
      document.body.appendChild(S.fileInput);
      S.fileInput.addEventListener('change', function (e) {
        var f = e.target.files && e.target.files[0];
        if (f) loadPdf(f);
      });
    }
    S.fileInput.value = '';
    S.fileInput.click();
  }

  function resetMap() {
    S.map = {
      form: { id: '', name: '', source_pages: 0, page_size: [595.32, 841.92] },
      sections: [], questions: []
    };
    S.currentQ = null;
    S.page = 1;
    renderQuestions();
    $('mapPageLabel').textContent = 'Page 1';
  }

  function loadPdf(file) {
    var reader = new FileReader();
    reader.onload = function () {
      var buf = reader.result;
      S.pdf = buf;
      pdfjsLib.getDocument({ data: buf.slice(0) }).promise.then(function (doc) {
        S.doc = doc;
        S.map.form.source_pages = doc.numPages;
        return renderAllPages(doc);
      }).then(function () {
        $('mapName').value = file.name.replace(/\.pdf$/i, '');
        S.page = 1;
        showPage(1);
        return autoDraft();
      }).then(function () {
        toast('PDF loaded');
      }).catch(function (e) {
        toast('Could not read that PDF: ' + e.message);
      });
    };
    reader.readAsArrayBuffer(file);
  }

  function renderAllPages(doc) {
    var out = [];
    var i = 1;
    function next() {
      if (i > doc.numPages) { S.pages = out; return Promise.resolve(); }
      return doc.getPage(i).then(function (p) {
        var vp = p.getViewport({ scale: 1.4 });
        var c = document.createElement('canvas');
        c.width = vp.width; c.height = vp.height;
        return p.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise.then(function () {
          out.push({ dataUrl: c.toDataURL('image/jpeg', 0.8), w: vp.width, h: vp.height });
          i++;
          return next();
        });
      });
    }
    return next();
  }

  /* ---------------- auto-draft ---------------- */
  function autoDraft() {
    if (!window.FormaticDraft || !S.doc) return Promise.resolve(0);
    return FormaticDraft.draft(S.doc).then(function (items) {
      if (!items.length) return 0;
      var section = null, count = 0, nq = 0;

      items.forEach(function (it) {
        if (it.kind === 'section') {
          section = { id: 'ds' + (nq + 1), title: it.title, letter: '', page: it.page, y: 0 };
          S.map.sections.push(section);
          return;
        }
        nq++;
        var q = {
          id: 'dq' + nq,
          section: section ? section.id : 'S' + it.page,
          number: String(nq),
          page: it.page,
          prompt: it.prompt || ('Field ' + nq),
          fields: []
        };
        if (it.kind === 'text') {
          (it.fields || []).forEach(function (f, fi) {
            q.fields.push({
              key: 'df' + nq + '_' + fi, label: f.label || it.prompt, type: 'text',
              page: it.page, x: f.x, y: f.y, w: f.w, size: f.size || 9
            });
            count++;
          });
        } else {
          q.fields.push({
            key: 'dc' + nq, label: it.prompt, type: 'choice',
            page: it.page, options: it.options
          });
          count += it.options.length;
        }
        S.map.questions.push(q);
      });

      if (!S.map.sections.length) {
        S.map.sections.push({ id: 'S1', title: 'Page 1', letter: '', page: 1, y: 0 });
      }
      S.currentQ = S.map.questions[0] || null;
      renderQuestions();
      drawOverlay();
      toast('Drafted ' + S.map.questions.length + ' questions (' + count + ' slots) — delete anything wrong, add anything missing');
      return count;
    }).catch(function () { return 0; });
  }

  /* ---------------- drawing ---------------- */
  function showPage(n) {
    if (!S.doc) return;
    S.page = Math.max(1, Math.min(n, S.doc.numPages));
    $('mapPageLabel').textContent = 'Page ' + S.page + ' of ' + S.doc.numPages;

    S.doc.getPage(S.page).then(function (p) {
      var vp = p.getViewport({ scale: S.scale });
      var c = $('mapCanvas');
      c.width = vp.width; c.height = vp.height;
      c.style.width = vp.width + 'px';
      c.style.height = vp.height + 'px';
      return p.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
    }).then(function () {
      S.map.form.page_size = [595.32, 841.92];
      drawOverlay();
    });
  }

  function drawOverlay() {
    var layer = $('mapOverlay');
    layer.innerHTML = '';
    var c = $('mapCanvas');
    var scale = c.clientWidth / 595.32;

    S.map.questions.forEach(function (q) {
      q.fields.forEach(function (f) {
        if (f.page !== S.page) return;
        if (f.type === 'text') {
          var box = el('div', { class: 'slot-box' });
          box.style.left = (f.x * scale) + 'px';
          box.style.top = ((f.y - f.size) * scale) + 'px';
          box.style.width = (f.w * scale) + 'px';
          box.style.height = ((f.size + 3) * scale) + 'px';
          if (q === S.currentQ) box.classList.add('live');
          layer.appendChild(box);
        } else {
          (f.options || []).forEach(function (o) {
            var b = el('div', { class: 'check-box' });
            b.style.left = (o.box.x * scale) + 'px';
            b.style.top = (o.box.y * scale) + 'px';
            b.style.width = (o.box.w * scale) + 'px';
            b.style.height = (o.box.h * scale) + 'px';
            if (q === S.currentQ) b.classList.add('live');
            layer.appendChild(b);
          });
        }
      });
    });
  }

  /* ---------------- adding fields ---------------- */
  function onCanvasClick(e) {
    if (!S.doc) return;
    var rect = $('mapCanvas').getBoundingClientRect();
    var x = (e.clientX - rect.left) / rect.width * 595.32;
    var y = (e.clientY - rect.top) / rect.height * 841.92;

    if (!S.currentQ) newQuestion();

    if (S.mode === 'text') {
      S.currentQ.fields.push({
        key: 'f' + Date.now() + Math.floor(Math.random() * 99),
        label: '', type: 'text', page: S.page,
        x: Math.round(x * 10) / 10, y: Math.round((y + 4) * 10) / 10,
        w: 180, size: 9
      });
    } else {
      var cf = S.currentQ.fields.filter(function (f) { return f.type === 'choice'; })[0];
      if (!cf) {
        cf = { key: 'c' + Date.now(), label: '', type: 'choice', page: S.page, options: [] };
        S.currentQ.fields.push(cf);
      }
      cf.options.push({
        label: '',
        box: { x: Math.round((x - 5.5) * 10) / 10, y: Math.round((y - 5.5) * 10) / 10, w: 11, h: 11 }
      });
    }
    renderQuestions();
    drawOverlay();
  }

  function newQuestion() {
    var q = {
      id: 'm' + (S.map.questions.length + 1),
      section: 'S' + S.page,
      number: String(S.map.questions.length + 1),
      page: S.page,
      prompt: '',
      fields: []
    };
    S.map.questions.push(q);
    if (!S.map.sections.some(function (s) { return s.id === q.section; })) {
      S.map.sections.push({ id: q.section, title: 'Page ' + S.page, letter: String(S.page), page: S.page, y: 0 });
    }
    S.currentQ = q;
    renderQuestions();
    var input = document.querySelector('.q-prompt[data-q="' + q.id + '"]');
    if (input) input.focus();
  }

  /* ---------------- side panel ---------------- */
  function renderQuestions() {
    var wrap = $('mapQuestions');
    wrap.innerHTML = '';

    if (!S.map.questions.length) {
      wrap.appendChild(el('p', { class: 'muted', text: 'No questions yet. Click “+ New question”, then click the page where the answer goes.' }));
      return;
    }

    S.map.questions.forEach(function (q) {
      var card = el('div', { class: 'q-card' + (q === S.currentQ ? ' active' : '') });

      var prompt = el('input', {
        class: 'q-prompt', 'data-q': q.id, placeholder: 'Question as you want to be asked',
        value: q.prompt, oninput: function (e) { q.prompt = e.target.value; },
        onfocus: function () { S.currentQ = q; renderQuestions(); drawOverlay(); }
      });
      card.appendChild(prompt);

      q.fields.forEach(function (f, fi) {
        if (f.type === 'text') {
          card.appendChild(el('div', { class: 'f-row' }, [
            el('input', {
              class: 'f-label', placeholder: 'Field label (optional)', value: f.label,
              oninput: function (e) { f.label = e.target.value; }
            }),
            el('input', {
              class: 'f-width', type: 'number', min: '20', max: '400', step: '5', value: f.w,
              title: 'Width in points',
              oninput: function (e) { f.w = Math.max(20, Math.min(400, Number(e.target.value) || 180)); drawOverlay(); }
            }),
            el('button', { class: 'x', text: '×', onclick: function () { q.fields.splice(fi, 1); renderQuestions(); drawOverlay(); } })
          ]));
        } else {
          (f.options || []).forEach(function (o, oi) {
            card.appendChild(el('div', { class: 'f-row' }, [
              el('input', {
                class: 'f-label', placeholder: 'Option label', value: o.label,
                oninput: function (e) { o.label = e.target.value; }
              }),
              el('button', {
                class: 'x', text: '×',
                onclick: function () { f.options.splice(oi, 1); renderQuestions(); drawOverlay(); }
              })
            ]));
          });
        }
      });

      card.appendChild(el('div', { class: 'q-meta', text: 'Page ' + q.page + ' · ' + q.fields.length + ' field' + (q.fields.length === 1 ? '' : 's') }));
      wrap.appendChild(card);
    });
  }

  /* ---------------- saving ---------------- */
  function save() {
    var name = $('mapName').value.trim();
    if (!name) { toast('Give the form a name first'); return; }
    if (!S.map.questions.length) { toast('Add at least one question'); return; }

    // drop empty questions and empty options; fill sensible labels
    S.map.questions = S.map.questions.filter(function (q) { return q.fields.length > 0; });
    S.map.questions.forEach(function (q) {
      q.prompt = q.prompt || 'Question ' + q.number;
      q.fields.forEach(function (f) {
        if (f.type === 'choice') f.options = (f.options || []).filter(function (o) { return true; });
        if (!f.label) f.label = q.prompt;
      });
    });
    if (!S.map.questions.length) { toast('Add at least one field'); return; }

    var id = slug(name) + '-' + Date.now().toString(36).slice(-4);
    S.map.form.id = id;
    S.map.form.name = name;

    FormaticStore.put({
      id: id, name: name, map: S.map, pages: S.pages, pdf: S.pdf, createdAt: Date.now()
    }).then(function () {
      toast('Saved — “' + name + '” is ready to fill');
      if (window.FormaticApp) window.FormaticApp.refreshHome();
      close();
    }).catch(function (e) {
      toast('Could not save: ' + e.message);
    });
  }

  function close() {
    $('mapper').hidden = true;
    if (window.FormaticApp) window.FormaticApp.refreshHome();
  }

  /* ---------------- wire up ---------------- */
  document.addEventListener('DOMContentLoaded', function () {
    $('mapCanvas').addEventListener('click', onCanvasClick);
    $('prevPage').addEventListener('click', function () { showPage(S.page - 1); });
    $('nextPage').addEventListener('click', function () { showPage(S.page + 1); });
    $('newQuestion').addEventListener('click', newQuestion);
    $('mapSave').addEventListener('click', save);
    $('mapCancel').addEventListener('click', close);
    $('modeText').addEventListener('click', function () { setMode('text'); });
    $('modeCheck').addEventListener('click', function () { setMode('check'); });
  });

  function setMode(m) {
    S.mode = m;
    $('modeText').classList.toggle('on', m === 'text');
    $('modeCheck').classList.toggle('on', m === 'check');
    $('mapHint').textContent = m === 'text'
      ? 'Click where an answer should be written.'
      : 'Click each checkbox on the page — each click adds one option.';
  }

  var toastTimer;
  function toast(msg) {
    var t = $('toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.hidden = true; }, 3200);
  }

  window.FormaticMapper = { open: open };
})();
