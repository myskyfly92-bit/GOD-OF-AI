#!/usr/bin/env python3
"""style.css(다크) → light.css(라이트 모드 덮어쓰기) 자동 생성.
   html[data-theme="light"] 일 때만 적용되는 규칙을 만든다.
   - 변수(:root)는 light-base.css 에서 직접 정의
   - 하드코딩된 색은 규칙별로 밝기를 뒤집어(어두운 바탕→밝은 바탕, 밝은 글씨→어두운 글씨) 덮어쓴다
   - 배너(topbar)·인트로·마스코트 같은 '어두운 섬'은 그대로 둔다
   사용: python3 tools/gen-light.py  (style.css 를 고친 뒤 다시 돌리면 됨)"""
import re, colorsys, os
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
css = open(os.path.join(ROOT, 'style.css'), encoding='utf-8').read()
base = open(os.path.join(ROOT, 'tools', 'light-base.css'), encoding='utf-8').read()
css = re.sub(r'/\*.*?\*/', '', css, flags=re.S)

SKIP_SEL = re.compile(r'topbar|hse-intro|mascot|kiosk|brand|sky-layer|clock|flap|hse-guide|vc-win|vc-pop|visit-counter|net-pill|\.vc-|desk-tip|desk-box|desk-toast|bg-reveal|guide-|wx-fx|rain|snow|plane-icon|::selection|@font', re.I)
COLOR_PROPS = {'color', 'fill', 'stroke', 'caret-color', '-webkit-text-fill-color', 'text-decoration-color'}
SURF_PROPS = re.compile(r'^(background(-color|-image)?|border(-(top|bottom|left|right))?(-color)?|outline(-color)?|box-shadow|text-shadow|column-rule(-color)?)$')

def parse_color(tok):
    tok = tok.strip()
    m = re.fullmatch(r'#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})', tok)
    if m:
        h = m.group(1)
        if len(h) == 3: h = ''.join(c * 2 for c in h)
        a = int(h[6:8], 16) / 255 if len(h) == 8 else 1
        return int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16), a
    m = re.fullmatch(r'rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+%?)\s*)?\)', tok)
    if m:
        a = m.group(4)
        a = (float(a[:-1]) / 100 if a and a.endswith('%') else float(a)) if a else 1
        return float(m.group(1)), float(m.group(2)), float(m.group(3)), a
    if tok.lower() in ('white', '#fff'): return 255, 255, 255, 1
    return None

def fmt(r, g, b, a):
    r, g, b = [max(0, min(255, round(x))) for x in (r, g, b)]
    return f'rgba({r},{g},{b},{round(a, 3)})' if a < 0.999 else '#%02x%02x%02x' % (r, g, b)

def hls(r, g, b): return colorsys.rgb_to_hls(r / 255, g / 255, b / 255)
def rgb(h, l, s): return [x * 255 for x in colorsys.hls_to_rgb(h, l, s)]

def conv(col, kind, body=''):
    r, g, b, a = col
    h, l, s = hls(r, g, b)
    if kind == 'text':
        if l < 0.25:
            # 어두운 글씨: 같은 규칙의 바탕이 테마 색 변수(var(--cyan) 등, 라이트에선 진해짐)일 때만 흰 글씨로.
            # 바탕이 밝은 고정색이거나 바탕이 없으면 어두운 글씨 그대로 (흰 화면에서 읽힘)
            if re.search(r'background(-color)?\s*:[^;]*var\(--', body): return fmt(*rgb(h, 0.98, s * 0.2), a)
            return None
        if l >= 0.4: return fmt(*rgb(h, max(0.16, min(0.38, 1.08 - l)), min(1, s * 1.05)), a)
        return None
    # surface (배경·테두리·그림자)
    if r == g == b == 0: return fmt(0, 0, 0, a * 0.3)                     # 검은 그림자는 옅게
    if l > 0.88 and a < 0.6: return fmt(20, 40, 60, min(0.5, a * 1.15))  # 흰 반투명 칠 → 어두운 반투명 칠
    if l < 0.2: return fmt(*rgb(h, 1 - l * 0.45, s * 0.35), a)           # 어두운 판 → 밝은 판
    return None

TOK = re.compile(r'#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)|\bwhite\b')
def conv_decl(prop, val, body=''):
    p = prop.strip().lower()
    if p.startswith('--'):
        # 부품마다 정한 색 변수(--c 등): 값이 색 하나뿐이면 글자색처럼 진하게 (테두리·글자에 같이 쓰임)
        if not parse_color(val.strip()): return None
        kind = 'text'
    else:
        kind = 'text' if p in COLOR_PROPS else 'surf' if SURF_PROPS.match(p) else None
    if not kind: return None
    changed = [False]
    def rep(m):
        c = parse_color(m.group(0))
        if not c: return m.group(0)
        n = conv(c, kind, body)
        if n is None: return m.group(0)
        changed[0] = True; return n
    nv = TOK.sub(rep, val)
    return nv if changed[0] else None

def prefix(sel):
    out = []
    for s in sel.split(','):
        s = s.strip()
        if not s or s.startswith('@') or re.match(r'^(from|to|\d+%)$', s): return None
        if s.startswith(':root'): return None
        # :where() 로 감싸 원래 규칙과 같은 우선순위를 유지 → .active·:hover 같은 상태 규칙이 그대로 이긴다
        if s.startswith('html'): out.append(':where(html[data-theme="light"])' + s[4:])
        else: out.append(':where(html[data-theme="light"]) ' + s)
    return ', '.join(out)

out = []
def walk(text, ctx):
    i, n = 0, len(text)
    while i < n:
        j = text.find('{', i)
        if j < 0: break
        pre = text[i:j].strip()
        # 짝 맞는 } 찾기
        d, k = 1, j + 1
        while k < n and d:
            if text[k] == '{': d += 1
            elif text[k] == '}': d -= 1
            k += 1
        body = text[j + 1:k - 1]
        if pre.startswith('@media') or pre.startswith('@supports'):
            walk(body, ctx + [pre])
        elif pre.startswith('@'):
            pass  # keyframes 등은 건너뜀
        elif pre and not SKIP_SEL.search(pre):
            decls = []
            for d_ in body.split(';'):
                if ':' not in d_: continue
                p, v = d_.split(':', 1)
                nv = conv_decl(p, v, body)
                if nv is not None:
                    imp = '' if '!important' in nv else ''
                    decls.append(f'{p.strip()}: {nv.strip()}')
            sel = prefix(pre)
            if decls and sel:
                rule = f'{sel} {{ ' + '; '.join(decls) + '; }'
                for m in reversed(ctx): rule = f'{m} {{ {rule} }}'
                out.append(rule)
        i = k
walk(css, [])
res = '/* 자동 생성 파일 — 직접 고치지 말고 tools/gen-light.py · tools/light-base.css 를 고친 뒤 다시 생성 */\n' + base + '\n/* ---- style.css 에서 자동 변환한 색 ---- */\n' + '\n'.join(out) + '\n'
# 손으로 맞춘 마무리 (자동 변환 뒤에 와야 이김)
fix = os.path.join(ROOT, 'tools', 'light-fix.css')
if os.path.exists(fix): res += '\n/* ---- 손으로 맞춘 부분 ---- */\n' + open(fix, encoding='utf-8').read()
open(os.path.join(ROOT, 'light.css'), 'w', encoding='utf-8').write(res)
print('light.css 생성:', len(out), '규칙')
