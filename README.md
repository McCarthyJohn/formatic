# Formatic

**Live:** https://mccarthyjohn.github.io/formatic/

Turn a paper PDF form into an interview, then download **the original PDF with the answers
drawn on top**. No server, no account — everything runs in the browser.

## The promise

The returned PDF is the same document you started with:

* the page is never re-rendered or re-flowed;
* every original word stays where it was, in the same order;
* answers are drawn as an extra layer at the exact coordinates of each blank;
* the file still opens in Preview, Acrobat, or any browser's PDF viewer.

`pdf-lib` copies the source document and adds content to the page — it does not rebuild it.

## Layout

```
formatic/
├── index.html            app shell
├── styles.css
├── app.js                interview, preview, fill, download
├── lib/pdf-lib.min.js    vendored (no CDN at runtime)
├── sw.js                 offline cache
├── forms/
│   └── sale-onboarding/
│       ├── map.json      the question map (sections, questions, slots, checkboxes)
│       ├── source.pdf    the original form
│       └── pages/        page images used for the live preview
└── tools/
    ├── build_map.py      PDF -> map.json (pymupdf)
    ├── extract.py        row inspection during mapping
    └── serve.py          dev server + POST /capture (testing only)
```

## How the map works

`map.json` is the only thing that is form-specific:

```json
{
  "form": { "id": "sale-onboarding", "name": "...", "source_pages": 13 },
  "sections": [{ "id": "S2", "title": "PROPERTY DETAILS", "page": 1, "y": 448 }],
  "questions": [{
    "id": "q1-1", "number": "1", "page": 1,
    "prompt": "Property address",
    "fields": [{
      "key": "q1-1-1", "label": "Property address", "type": "text",
      "page": 1, "x": 230.0, "y": 486.9, "w": 311.0, "size": 9
    }]
  }]
}
```

* Coordinates are in PDF points, **top-down** (the app flips them for pdf-lib).
* `type: "choice"` and `"multi"` fields carry `options[]`, each with its label and the
  checkbox's box `{x, y, w, h}` in the same coordinate space.
* The interview groups questions by `section`; the rail lists every question.

## Adding a form in the app (no code)

Home → **+ Add a form**:

1. Choose the PDF. Every page renders in the browser.
2. **+ New question** — type how you want to be asked it.
3. **Answer box**, then click where the answer goes. Set the width in the small box beside
   the field label if the column is narrow.
4. **Checkbox**, then click each box on the page — one click, one option. Label each option.
5. Repeat across pages with the arrows, then **Save form**.

The PDF and its map are stored in IndexedDB in this browser. Nothing is uploaded anywhere.

## Adding a form by script (bulk / higher accuracy)

1. Run the extractor:

   ```bash
   python3 tools/build_map.py path/to/form.pdf forms/<id>/map.json
   ```

2. Copy the PDF to `forms/<id>/source.pdf` and render page images to `forms/<id>/pages/`.
3. Review the draft map — the extractor gets the table structure right but legal forms
   always need a human pass on wording and the odd merged cell.
4. Add an entry to `FORMS` in `app.js`.

## Testing

`tools/serve.py` serves the app and accepts the generated PDF at `POST /capture`, which is how
the fidelity checks are run:

```bash
python3 tools/serve.py 8124
# answer some questions in the browser, click Download PDF
python3 - <<'EOF'
import pymupdf
a = pymupdf.open('forms/sale-onboarding/source.pdf')
b = pymupdf.open('tools/out/captured.pdf')
for i in range(a.page_count):
    pa = [w[4] for w in a[i].get_text('words')]
    pb = [w[4] for w in b[i].get_text('words')]
    assert pb[:len(pa)] == pa, 'page %d changed' % (i + 1)
print('every original word preserved, in order, on every page')
EOF
```

## Releasing

Assets are referenced as `app.js?v=N` because GitHub Pages caches for ten minutes.
When you change anything:

1. bump `?v=` on every script/style in `index.html`,
2. bump `CACHE_VERSION` in `sw.js` to match,
3. `git push`.

Client forms in `forms/` are gitignored on purpose — they never reach the public site.
