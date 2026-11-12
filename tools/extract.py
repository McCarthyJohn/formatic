import pymupdf, json, sys, re

SRC = sys.argv[1] if len(sys.argv) > 1 else None
OUT = sys.argv[2] if len(sys.argv) > 2 else 'map-draft.json'


def page_rows(pg):
    """Horizontal rules spanning the form width -> row bands."""
    rules = []
    for dr in pg.get_drawings():
        r = dr['rect']
        if r.width > 300 and r.height < 1.2:
            rules.append(round(r.y0, 1))
    rules = sorted(set(rules))
    merged = []
    for y in rules:
        if not merged or abs(y - merged[-1]) > 2:
            merged.append(y)
    return merged


def collect(pg):
    rows = []
    ys = page_rows(pg)
    words = pg.get_text('words')
    for i in range(len(ys) - 1):
        y0, y1 = ys[i], ys[i + 1]
        if y1 - y0 < 6:
            continue
        band = [w for w in words if w[1] >= y0 - 0.5 and w[3] <= y1 + 0.5]
        num = ' '.join(w[4] for w in band if w[2] < 56)
        label = ' '.join(w[4] for w in band if 56 <= w[0] < 224)
        ans = [w for w in band if w[0] >= 224]
        rows.append({
            'y0': y0, 'y1': y1,
            'num': num.strip(),
            'label': label.strip(),
            'ans_text': ' '.join(w[4] for w in ans),
            'ans_x_max': round(max([w[2] for w in ans], default=224), 1),
            'checks': [{'x': round(w[0], 1), 'y': round(w[1], 1), 'word': w[4]}
                       for w in ans if w[4] == '\uf06f'],
        })
    return rows


if __name__ == '__main__':
    doc = pymupdf.open(SRC)
    print('pages', doc.page_count)
    for pno in range(min(3, doc.page_count)):
        print('\n===== PAGE %d =====' % (pno + 1))
        for r in collect(doc[pno]):
            print('  y %.0f-%.0f | num=%-10r | label=%-58r | ans=%r | checks=%d' % (
                r['y0'], r['y1'], r['num'], r['label'][:55], r['ans_text'][:40], len(r['checks'])))
