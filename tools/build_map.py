import pymupdf, json, re, sys

SRC = sys.argv[1]
OUT = sys.argv[2] if len(sys.argv) > 2 else 'forms/sale-onboarding.map.json'

RIGHT_EDGE = 545.0
LEFT_COL = 224.0


def headings(pg, pno):
    """Titles are the 12pt spans; body copy is 10pt."""
    out = []
    for b in pg.get_text('dict')['blocks']:
        for line in b.get('lines', []):
            for s in line['spans']:
                txt = s['text'].strip()
                if s['size'] >= 11.5 and len(txt) > 2:
                    out.append({'page': pno + 1, 'y': round(s['bbox'][1], 1), 'text': re.sub(r'\s+', ' ', txt)})
    # one entry per visual line
    ded = []
    for h in out:
        if ded and ded[-1]['page'] == h['page'] and abs(ded[-1]['y'] - h['y']) < 2:
            ded[-1]['text'] += ' ' + h['text']
        else:
            ded.append(h)
    return ded


def rules(pg):
    rs = []
    for dr in pg.get_drawings():
        r = dr['rect']
        if r.width > 300 and r.height < 1.2:
            rs.append(round(r.y0, 1))
    rs = sorted(set(rs))
    merged = []
    for y in rs:
        if not merged or abs(y - merged[-1]) > 2:
            merged.append(y)
    return merged


def options_from(ans):
    # Each box's label is the run of words on its own line, stopping at the next box
    # or a wide gap. The form lays options out in a multi-column grid, so this must
    # not reach across a column or down to the next line.
    glyphs = [w for w in ans if w[4] == '\uf06f']
    opts = []
    for g in glyphs:
        same_line = [w for w in ans if w[4] != '\uf06f' and w[0] > g[2] and abs(w[1] - g[1]) < 4.5]
        for other in glyphs:
            if other is not g and abs(other[1] - g[1]) < 5 and other[0] > g[0]:
                same_line = [w for w in same_line if w[0] < other[0] - 1]
        same_line.sort(key=lambda w: w[0])
        words, prev_x = [], g[2]
        for w in same_line:
            if w[0] - prev_x > 18:
                break
            words.append(w[4])
            prev_x = w[2]
        text = ' '.join(words).strip(' -')
        opts.append({'label': re.sub(r'\s+', ' ', text),
                     'box': {'x': round(g[0] - 1.5, 1), 'y': round(g[1] - 1.5, 1), 'w': 11, 'h': 11}})
    return opts


def build(src):
    doc = pymupdf.open(src)
    sections, questions = [], []
    cur_sec = None
    cur_q = None

    for pno in range(doc.page_count):
        pg = doc[pno]
        hs = headings(pg, pno)
        ys = rules(pg)
        hi = 0
        for i in range(len(ys) - 1):
            y0, y1 = ys[i], ys[i + 1]
            if y1 - y0 < 6 or y1 > 780:
                continue

            # any heading above this row that we haven't consumed yet
            while hi < len(hs) and hs[hi]['y'] < y1:
                h = hs[hi]
                title = re.sub(r'^[A-Z]\d?\s*[–-]\s*', '', h['text']).strip()
                if title and not any(s['title'].lower() == title.lower() for s in sections):
                    sec_id = 'S%d' % (len(sections) + 1)
                    sections.append({'id': sec_id, 'title': title, 'letter': h['text'].split('–')[0].strip(),
                                     'page': h['page'], 'y': h['y']})
                    cur_sec = sec_id
                    cur_q = None
                hi += 1

            if y0 < 68:
                continue

            words = [w for w in pg.get_text('words') if w[1] >= y0 - 0.5 and w[3] <= y1 + 0.5]
            num = ' '.join(w[4] for w in words if w[2] < 56).strip()
            label = ' '.join(w[4] for w in words if 56 <= w[0] < LEFT_COL).strip()
            ans = sorted([w for w in words if w[0] >= LEFT_COL - 0.5], key=lambda w: (round(w[1]), w[0]))
            if not num and not label and not ans:
                continue

            opts = options_from(ans)
            caption = ' '.join(w[4] for w in ans if w[4] != '\uf06f').strip()

            # heading-only rows (all caps, no boxes, no writing line) are not questions
            letters = [c for c in caption if c.isalpha()]
            if not opts and not num and letters and sum(1 for c in letters if c.isupper()) / len(letters) > 0.9:
                continue

            if num and re.match(r'^\d+[A-Z]?$', num):
                cur_q = {'id': 'q%s-%d' % (num, len(questions) + 1), 'section': cur_sec,
                         'number': num, 'page': pno + 1, 'prompt': label, 'fields': []}
                questions.append(cur_q)
            if cur_q is None:
                continue

            # single-select unless the form says "tick all that apply" in so many words
            asks_many = bool(re.search(r'tick|all that apply|select all|services below|which of the following',
                                       (label or '') + ' ' + caption, re.I))
            ftype = 'text' if not opts else ('multi' if (asks_many and len(opts) > 2) else 'choice')
            flabel = caption or label or cur_q['prompt']
            fid = '%s-%d' % (cur_q['id'], len(cur_q['fields']) + 1)
            if ftype == 'text':
                # a dotted leader is the writing line: start on it, not after it
                dots = [w for w in ans if len(w[4]) >= 4 and set(w[4]) <= set('…().')]
                if dots:
                    # merge adjacent dot words into single writing lines
                    runs = []
                    for d in sorted(dots, key=lambda w: (round(w[1]), w[0])):
                        if runs and abs(d[1] - runs[-1][1]) < 3 and d[0] - runs[-1][2] < 8:
                            runs[-1][2] = d[2]
                        else:
                            runs.append([d[0], d[1], d[2], d[3]])
                    if len(runs) > 1:
                        # one row, several writing lines ("Volume …… Folio …… Lot ……")
                        for ri, run in enumerate(runs):
                            same_line = [r for r in runs[ri + 1:] if abs(r[1] - run[1]) < 3]
                            nxt = same_line[0][0] if same_line else RIGHT_EDGE
                            before = [w for w in ans if w[2] <= run[0] + 1 and w[4] != '\uf06f'
                                      and abs(w[1] - run[1]) < 5 and not (len(w[4]) >= 4 and set(w[4]) <= set('…().'))]
                            lab = before[-1][4].strip(' :') if before else flabel
                            cur_q['fields'].append({
                                'key': '%s-%d' % (cur_q['id'], len(cur_q['fields']) + 1),
                                'label': lab or flabel, 'type': 'text', 'page': pno + 1,
                                'x': round(run[0] + 1, 1), 'y': round(run[3] - 2.7, 1),
                                'w': round(max(nxt - run[0] - 4, 24), 1), 'size': 8.5})
                        continue
                    x = runs[0][0] + 1
                    ybase = runs[0][3] - 2.9   # baseline level with the dots, not below them
                else:
                    x = max([w[2] for w in ans], default=LEFT_COL) + 6
                    ybase = y1 - 4.5
                x = min(x, RIGHT_EDGE - 40)
                fld = {'key': fid, 'label': flabel, 'type': 'text', 'page': pno + 1,
                       'x': round(x, 1), 'y': round(ybase, 1),
                       'w': round(RIGHT_EDGE - x - 4, 1), 'size': 9}
            else:
                fld = {'key': fid, 'label': flabel, 'type': ftype, 'page': pno + 1,
                       'options': opts, 'size': 9}
            cur_q['fields'].append(fld)

    # --- post-pass: strip prose that the row detector mistook for answer slots ---
    clean_qs = []
    for q in questions:
        keep = []
        for f in q['fields']:
            label = f.get('label', '')
            words = label.split()
            if f['type'] == 'text':
                if len(words) > 12:                      # a paragraph, not a field name
                    continue
                if 'http' in label or 'docx' in label:
                    continue
                letters = [c for c in label if c.isalpha()]
                if letters and all(c.isupper() for c in letters):
                    continue                             # section heading captured as a slot
            keep.append(f)
        prompt = q.get('prompt', '')
        if not keep:
            continue
        if prompt.startswith('**'):
            continue
        q['fields'] = keep
        clean_qs.append(q)

    return {'form': {'id': 'sale-onboarding', 'name': 'Onboarding Form / Sale Instructions',
                     'source_pages': doc.page_count, 'page_size': [595.32, 841.92]},
            'sections': sections, 'questions': clean_qs}


if __name__ == '__main__':
    res = build(SRC)
    with open(OUT, 'w') as f:
        json.dump(res, f, indent=1)
    qs = res['questions']
    print('sections: %d  questions: %d  fields: %d' % (len(res['sections']), len(qs), sum(len(q['fields']) for q in qs)))
    for s in res['sections']:
        print('  [%s] p%d y%.0f  %s' % (s['id'], s['page'], s['y'], s['title'][:70]))
