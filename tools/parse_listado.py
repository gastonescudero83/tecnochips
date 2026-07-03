# -*- coding: utf-8 -*-
"""
parse_listado.py — Convierte "listado articulos.txt" en un backup JSON importable
por la tienda (Admin → Importar/Exportar → Restaurar backup).

Salida: tienda-online/data/catalogo.json  (formato Store.exportAll())

Reglas:
  - Precios "tal cual" (sin conversión). Celulares/consolas en USD, Smart TV en pesos.
    Se agrega nota de moneda en la descripción.
  - Categorías por tipo (Celulares / Smart TV / Consolas / Accesorios) y
    subcategorías por marca.
  - Apple Tester: se consolidan unidades repetidas en stock, con garantías en la descripción.
  - Imágenes: placeholder SVG por marca (gradiente + emoji), 100% offline.

Re-ejecutable: si actualizás el .txt, volvé a correr el script.
"""
import re, json, time
from urllib.parse import quote

SRC = r"C:\Users\gasto\OneDrive\Escritorio\CLAUDE TRABAJO\listado articulos.txt"
OUT = r"C:\Users\gasto\OneDrive\Escritorio\CLAUDE TRABAJO\tienda-online\data\catalogo.json"

# ---- Marcas: (color1, color2, emoji) para el placeholder -------------------
BRANDMETA = {
    'Apple': ('#1d1d1f', '#3a3a3c', '📱'),
    'Samsung': ('#1428a0', '#0b1560', '📱'),
    'Xiaomi': ('#ff6900', '#c43e00', '📱'),
    'Motorola': ('#1c3faa', '#0a1f63', '📱'),
    'Realme': ('#f8c80a', '#b98e00', '📱'),
    'Infinix': ('#0aa6a0', '#066d69', '📱'),
    'Tecno': ('#0b3d91', '#06245a', '📱'),
    'ZTE': ('#0055a5', '#003366', '📱'),
    'Kanji': ('#444444', '#222222', '📺'),
    'Noblex': ('#e2001a', '#990012', '📺'),
    'TCL': ('#0b1f3a', '#000000', '📺'),
    'RCA': ('#cc0000', '#800000', '📺'),
    'Sony': ('#003791', '#001f54', '🎮'),
    'Microsoft': ('#107c10', '#0b5e0b', '🎮'),
    'Nintendo': ('#e60012', '#99000c', '🎮'),
    'Logitech': ('#0a7aa3', '#055066', '🎮'),
}

CAT_DEF = {
    'cat_celulares': ('Celulares', '📱', 0),
    'cat_tv': ('Smart TV', '📺', 1),
    'cat_consolas': ('Consolas y Gaming', '🎮', 2),
    'cat_accesorios': ('Accesorios', '🔌', 3),
}
SUB_DEF = {
    'sub_iphone': ('cat_celulares', 'iPhone'),
    'sub_samsung': ('cat_celulares', 'Samsung'),
    'sub_xiaomi': ('cat_celulares', 'Xiaomi'),
    'sub_motorola': ('cat_celulares', 'Motorola'),
    'sub_realme': ('cat_celulares', 'Realme'),
    'sub_infinix': ('cat_celulares', 'Infinix'),
    'sub_tecno': ('cat_celulares', 'Tecno'),
    'sub_zte': ('cat_celulares', 'ZTE'),
    'sub_tv_kanji': ('cat_tv', 'Kanji'),
    'sub_tv_noblex': ('cat_tv', 'Noblex'),
    'sub_tv_tcl': ('cat_tv', 'TCL'),
    'sub_tv_rca': ('cat_tv', 'RCA'),
    'sub_tv_motorola': ('cat_tv', 'Motorola'),
    'sub_ps': ('cat_consolas', 'PlayStation'),
    'sub_xbox': ('cat_consolas', 'Xbox'),
    'sub_nintendo': ('cat_consolas', 'Nintendo'),
    'sub_gaming_acc': ('cat_consolas', 'Accesorios Gaming'),
    'sub_cargadores': ('cat_accesorios', 'Cargadores'),
}
CODE_PREFIX = {
    'Apple': 'IPH', 'Samsung': 'SAM', 'Xiaomi': 'XIA', 'Motorola': 'MOT',
    'Realme': 'RLM', 'Infinix': 'INF', 'Tecno': 'TEC', 'ZTE': 'ZTE',
    'Kanji': 'TV', 'Noblex': 'TV', 'TCL': 'TV', 'RCA': 'TV',
    'Sony': 'GAME', 'Microsoft': 'GAME', 'Nintendo': 'GAME', 'Logitech': 'GAME',
}

ACR = {'TV', 'QLED', 'UHD', 'NFC', 'OEM', 'RGB', 'VR2', 'PS5', 'GB', 'TB',
       '5G', '4G', 'LED', 'USB-C', 'ARG', 'FE', 'XS'}
STORAGE = {'64', '128', '256', '512', '1tb', '2tb'}


def xml_escape(s):
    return s.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')


def title(s):
    out = []
    for w in s.split():
        if any(c.isdigit() for c in w):
            out.append(w)                       # PS5, 512GB, 40", G29, 5G…
        elif w.upper() in ACR:
            out.append(w.upper())
        else:
            out.append(w[:1].upper() + w[1:].lower())
    return ' '.join(out)


def placeholder(label, brand):
    c1, c2, emoji = BRANDMETA.get(brand, ('#2563eb', '#1d4ed8', '📦'))
    label = xml_escape(label[:24])
    svg = (
        '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="800" viewBox="0 0 800 800">'
        '<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">'
        f'<stop offset="0" stop-color="{c1}"/><stop offset="1" stop-color="{c2}"/></linearGradient></defs>'
        '<rect width="800" height="800" fill="url(#g)"/>'
        f'<text x="400" y="330" font-size="230" text-anchor="middle" dominant-baseline="central">{emoji}</text>'
        f'<text x="400" y="545" font-size="44" fill="#ffffff" font-family="Segoe UI,Arial,sans-serif" '
        f'font-weight="700" text-anchor="middle">{xml_escape(brand)}</text>'
        f'<text x="400" y="602" font-size="29" fill="#ffffff" opacity="0.85" '
        f'font-family="Segoe UI,Arial,sans-serif" text-anchor="middle">{label}</text>'
        '</svg>'
    )
    return 'data:image/svg+xml,' + quote(svg, safe='')


# ---- Estado de los códigos -------------------------------------------------
_counters = {}
def make_code(brand):
    pref = CODE_PREFIX.get(brand, 'ART')
    _counters[pref] = _counters.get(pref, 0) + 1
    return f"{pref}-{_counters[pref]:03d}"


# ---- Parsing de precios ----------------------------------------------------
PRICE_RE = re.compile(r'\$\s*([\d][\d.]*)')
def parse_prices(line):
    return [(m, int(m.group(1).replace('.', ''))) for m in PRICE_RE.finditer(line)]


def clean_left(left):
    # quita viñetas/emojis/guiones bajos iniciales (no usa \w porque incluye '_')
    left = re.sub(r'^[^A-Za-z0-9("]+', '', left.strip())
    return left.strip().strip('_ ').strip()


def storage_disp(tok):
    return tok.upper() if 'tb' in tok.lower() else tok + 'GB'


def split_apple_model(tokens):
    """Devuelve (descriptor_tokens, storage_token, idx)."""
    idx = None
    for i, t in enumerate(tokens):
        if t.lower() in STORAGE:
            idx = i
    if idx is None:
        return tokens, None, None
    return tokens[:idx], tokens[idx], idx


# ---- Acumuladores ----------------------------------------------------------
products = []
used_subs = set()
tester_acc = {}   # key -> dict (consolidación)
NOW = int(time.time() * 1000)
_seq = [0]


def add_product(name, brand, sub_id, price, desc, tags, stock=8,
                is_new=False, featured=False, label=None):
    used_subs.add(sub_id)
    cat_id = SUB_DEF[sub_id][0]
    _seq[0] += 1
    pid = f"prod_{_seq[0]:04d}"
    products.append({
        'id': pid,
        'code': make_code(brand),
        'name': name,
        'brand': brand,
        'categoryId': cat_id,
        'subcategoryId': sub_id,
        'description': desc.strip(),
        'price': price,
        'priceOld': None,
        'priceSale': None,
        'stock': stock,
        'images': [placeholder(label or name, brand)],
        'tags': tags,
        'featured': featured,
        'isNew': is_new,
        'active': True,
        'createdAt': NOW - _seq[0] * 1000,
        'updatedAt': NOW - _seq[0] * 1000,
    })


USD_NOTE = '\n\n💵 Precio en dólares (USD).'
ARS_NOTE = '\n\n💵 Precio en pesos (ARS).'
FLAGSHIP = ('17 Pro Max', '16 Pro Max', 'S25 Ultra', 'S26', 'Switch 2',
            'PS5 Slim', 'F8 Ultra', 'Edge 70')


def is_flagship(name):
    return any(k in name for k in FLAGSHIP)


# ---- Loop principal --------------------------------------------------------
mode = None        # iphone_sealed | apple_oem | apple_tester | generic | tv | consoles
brand = None
sub = None

for raw in open(SRC, encoding='utf-8').read().splitlines():
    line = raw.strip()
    if not line:
        continue
    norm = line.upper()

    # ----- ¿Es encabezado? (sin precio) -----
    if '$' not in line:
        if 'IPHONE' in norm and 'SELLAD' in norm:
            mode, brand, sub = 'iphone_sealed', 'Apple', 'sub_iphone'
        elif 'APPLE OEM' in norm:
            mode, brand, sub = 'apple_oem', 'Apple', 'sub_iphone'
        elif 'APPLE TESTER' in norm:
            mode, brand, sub = 'apple_tester', 'Apple', 'sub_iphone'
        elif norm.strip('_* ') == 'XIAOMI':
            mode, brand, sub = 'generic', 'Xiaomi', 'sub_xiaomi'
        elif 'SMART TV STOCK' in norm:
            mode, brand, sub = 'tv', None, None
        elif 'ZTE / INFINIX' in norm:
            mode, brand, sub = 'generic', None, None
        elif 'CONSOLAS' in norm:
            mode, brand, sub = 'consoles', None, None
        elif '▶️' in line or '◀️' in line:    # sub-encabezado de marca (celulares)
            for b, s in [('ZTE', 'sub_zte'), ('INFINIX', 'sub_infinix'),
                         ('TECNO', 'sub_tecno'), ('REALME', 'sub_realme'),
                         ('MOTOROLA', 'sub_motorola'), ('SAMSUNG', 'sub_samsung')]:
                if b in norm:
                    brand = b.title() if b not in ('ZTE',) else 'ZTE'
                    sub = s
                    break
        elif mode == 'tv':                      # marca de TV (*KANJI*, *NOBLEX*…)
            key = norm.strip('_* ')
            tvmap = {'KANJI': ('Kanji', 'sub_tv_kanji'), 'NOBLEX': ('Noblex', 'sub_tv_noblex'),
                     'TCL': ('TCL', 'sub_tv_tcl'), 'RCA': ('RCA', 'sub_tv_rca'),
                     'MOTOROLA': ('Motorola', 'sub_tv_motorola')}
            if key in tvmap:
                brand, sub = tvmap[key]
        continue

    # ----- Línea de producto -----
    prices = parse_prices(line)
    if not prices:
        continue
    m0, price = prices[0]
    left = clean_left(line[:m0.start()])
    right_full = line[m0.end():]
    is_new = '🆕' in line
    last = ('🔥' in line)
    ultima = 'ÚLTIMA' in norm or 'ULTIMA' in norm
    nocharger = 'S/CARG' in norm

    # Colores / extras a la derecha (hasta el siguiente '$' si hay variante)
    right_main = right_full.split('$')[0]
    right_main = right_main.strip().strip('_ ').strip()
    alt_note = ''
    if len(prices) > 1:
        m1, p1 = prices[1]
        alt_colors = clean_left(line[m1.end():]).strip()
        alt_note = f"\nTambién disponible a ${p1:,}".replace(',', '.') + (f" ({alt_colors})" if alt_colors else "")

    # ===== APPLE SELLADO / OEM =====
    if mode in ('iphone_sealed', 'apple_oem'):
        desc_tokens, stor, idx = split_apple_model(left.split())
        if stor is None:
            continue
        descriptor = title(' '.join(desc_tokens))
        name = f"iPhone {descriptor} {storage_disp(stor)}".replace('  ', ' ').strip()
        colors = re.sub(r'_?ACTIVADO_?', '', right_main, flags=re.I).strip(' _')
        tags = ['Sellado'] if mode == 'iphone_sealed' else ['Reacondicionado']
        if mode == 'iphone_sealed':
            base = 'iPhone nuevo, sellado de fábrica.'
            if 'ACTIVADO' in norm:
                base += ' Activado.'
        else:
            base = 'iPhone original reacondicionado (OEM). Batería 100%, grado estético igual a nuevo, sin caja.'
        desc = base
        if colors:
            desc += f"\nColores: {colors}."
        desc += alt_note + USD_NOTE
        add_product(name, 'Apple', 'sub_iphone', price, desc, tags,
                    is_new=is_new, featured=is_flagship(name) or last,
                    label=f"{descriptor} {storage_disp(stor)}")
        continue

    # ===== APPLE TESTER (consolida unidades) =====
    if mode == 'apple_tester':
        toks = left.split()
        desc_tokens, stor, idx = split_apple_model(toks)
        if stor is None:
            continue
        after = toks[idx + 1:]
        battery = next((t for t in after if t.endswith('%')), '')
        color_toks = [t for t in after if not t.endswith('%')]
        descriptor = title(' '.join(desc_tokens))
        color = title(' '.join(color_toks))
        name = f"iPhone {descriptor} {storage_disp(stor)}".strip()
        if color:
            name += f" {color}"
        # extras a la derecha del precio (grado / garantía / ciclos)
        extra = right_main.upper()
        warranty = ''
        mw = re.search(r'G APPLE (\w+)', extra)
        if mw:
            warranty = mw.group(1).title()
        grade = ''
        mg = re.search(r'\b([AB][-+]?)\b', right_main.strip())
        if mg and 'APPLE' not in extra:
            grade = mg.group(1)
        key = (name, battery, price)
        acc = tester_acc.get(key)
        if not acc:
            acc = {'name': name, 'battery': battery, 'price': price, 'count': 0,
                   'warranties': [], 'grades': set(), 'ciclos': '0 CICLOS' in extra,
                   'is_new': is_new}
            tester_acc[key] = acc
        acc['count'] += 1
        if warranty:
            acc['warranties'].append(warranty)
        if grade:
            acc['grades'].add(grade)
        continue

    # ===== SMART TV =====
    if mode == 'tv':
        if brand is None:
            continue
        model = title(right_main if right_main and not left else left)
        name = f"{brand} {model}".strip()
        desc = f"Smart TV {brand} {model}."
        tags = ['Smart TV']
        stock = 8
        if ultima:
            tags.append('Última unidad'); stock = 1
        desc += ARS_NOTE
        add_product(name, brand, sub, price, desc, tags, stock=stock,
                    is_new=is_new, featured=last, label=model)
        continue

    # ===== CONSOLAS =====
    if mode == 'consoles':
        u = left.upper()
        if 'XBOX' in u:
            cbrand, csub = 'Microsoft', 'sub_xbox'
        elif 'NINTENDO' in u:
            cbrand, csub = 'Nintendo', 'sub_nintendo'
        elif 'LOGITECH' in u or 'VOLANTE' in u:
            cbrand, csub = 'Logitech', 'sub_gaming_acc'
        elif 'SONY' in u or 'PS5' in u:
            cbrand = 'Sony'
            csub = 'sub_gaming_acc' if any(k in u for k in ('LECTORA', 'JOYSTICK', 'VR2')) else 'sub_ps'
        else:
            cbrand, csub = 'Sony', 'sub_gaming_acc'
        name = title(left)
        desc = name + '.' + USD_NOTE
        add_product(name, cbrand, csub, price, desc, ['Gaming'],
                    is_new=is_new, featured=is_flagship(name) or last, label=name)
        continue

    # ===== GENÉRICO (celulares de marca / accesorios) =====
    if mode == 'generic' and brand:
        # ¿Accesorio (cargador)?
        if 'ADAPTER' in left.upper() or 'CARGADOR' in left.upper():
            model = title(left.replace('Adapter', '').replace('ADAPTER', '').strip())
            name = f"Cargador {brand} {model}".strip()
            desc = f"Cargador {brand} {model}." + USD_NOTE
            add_product(name, brand, 'sub_cargadores', price, desc, ['Accesorio'],
                        is_new=is_new, label=model)
            continue
        model = title(left)
        if brand == 'Xiaomi':
            name = model                                  # ya incluye Redmi/Poco/Mi
            if re.match(r'^Note\b', model):               # serie Redmi Note
                name = 'Redmi ' + model
        else:
            name = f"{brand} {model}"
        if name[-1:].isdigit():
            name += 'GB'
        # limpia sufijos tipo "+ KIT" para la descripción
        extras = ''
        for ex in ['+ KIT', '+ BUDS', '+ Buds', '+ CARG']:
            if ex.lower() in name.lower():
                extras += ' ' + ex
                name = re.sub(re.escape(ex), '', name, flags=re.I).strip()
        colors = right_main
        desc = f"{brand} {model} — equipo nuevo, libre."
        if colors:
            desc += f"\nColores: {colors}."
        if nocharger:
            desc += "\n⚠️ No incluye cargador."
        if extras:
            desc += f"\nIncluye:{extras}."
        tags = ['Nuevo'] if is_new else []
        stock = 1 if ultima else 8
        if ultima:
            tags.append('Última unidad')
        desc += USD_NOTE
        add_product(name.replace('  ', ' ').strip(), brand, sub, price, desc, tags,
                    stock=stock, is_new=is_new, featured=is_flagship(name) or last, label=model)
        continue

# ---- Emitir productos Tester consolidados ----------------------------------
for acc in tester_acc.values():
    desc = f"Equipo Apple Tester con garantía de 30 días. Batería {acc['battery'] or 'N/D'}."
    if acc['ciclos']:
        desc += " 0 ciclos."
    if acc['grades']:
        desc += f" Grado estético: {', '.join(sorted(acc['grades']))}."
    if acc['warranties']:
        from collections import Counter
        wc = Counter(acc['warranties'])
        desc += " Garantía Apple hasta: " + ', '.join(f"{k}" for k in wc) + "."
    desc += USD_NOTE
    add_product(acc['name'] + ' (Tester)', 'Apple', 'sub_iphone', acc['price'], desc,
                ['Usado', 'Garantía 30 días'], stock=acc['count'], is_new=acc['is_new'],
                featured=is_flagship(acc['name']), label=acc['name'].replace('iPhone ', ''))

# ---- Construir categorías (solo subcategorías usadas) ----------------------
cats = {}
for sub_id in used_subs:
    cat_id, sub_name = SUB_DEF[sub_id]
    if cat_id not in cats:
        cname, cicon, corder = CAT_DEF[cat_id]
        cats[cat_id] = {'id': cat_id, 'name': cname, 'icon': cicon, 'order': corder, 'subcategories': []}
    cats[cat_id]['subcategories'].append({'id': sub_id, 'name': sub_name})
categories = sorted(cats.values(), key=lambda c: c['order'])

# ---- Settings (marca TECNOCHIP'S) ------------------------------------------
settings = {
    'storeName': "TECNOCHIP'S",
    'slogan': 'Electro & Hogar',
    'whatsapp': '5491164339281',
    'currency': 'ARS', 'locale': 'es-AR', 'currencySymbol': '$',
    'logo': 'icons/logo.svg',
    'footer': "TECNOCHIP'S — Electro & Hogar · Instagram @tecnochip_s",
    'theme': {
        'primary': '#2b2722', 'primaryDark': '#16120e', 'accent': '#c0894a',
        'bg': '#efeae0', 'surface': '#ffffff', 'text': '#2b2722',
        'muted': '#8a8073', 'danger': '#c0392b', 'success': '#2e9e5b',
    },
    'tags': ['Nuevo', 'Sellado', 'Reacondicionado', 'Usado', 'Garantía 30 días',
             'Oferta', 'Destacado', 'Recomendado', 'Última unidad', 'Smart TV', 'Gaming', 'Accesorio'],
    'banner': {
        'title': "TECNOCHIP'S — Electro & Hogar",
        'subtitle': 'Celulares, Smart TV, consolas y tecnología al mejor precio',
        'image': '', 'ctaText': 'Ver productos', 'ctaTarget': 'destacados',
    },
    'featuredLimit': 12,
}

backup = {
    'meta': {'app': 'tienda-pwa', 'version': 1, 'exportedAt': NOW, 'source': 'listado articulos.txt'},
    'settings': settings,
    'categories': categories,
    'products': products,
    'comments': [],
}

with open(OUT, 'w', encoding='utf-8') as fh:
    json.dump(backup, fh, ensure_ascii=False, indent=1)

# ---- También escribe js/seed.js (para que la tienda arranque ya cargada) ---
SEED_OUT = r"C:\Users\gasto\OneDrive\Escritorio\CLAUDE TRABAJO\tienda-online\js\seed.js"
seed_payload = {'categories': categories, 'products': products, 'comments': []}
seed_js = (
    "/* =============================================================================\n"
    " * seed.js — Catálogo inicial de TECNOCHIP'S (GENERADO automáticamente)\n"
    " * -----------------------------------------------------------------------------\n"
    " * NO editar a mano: se regenera con  python tools/parse_listado.py\n"
    " * a partir de 'listado articulos.txt'. Se carga la primera vez (DB vacía).\n"
    " * ========================================================================== */\n"
    "(function (App) {\n  'use strict';\n  App.SEED = "
    + json.dumps(seed_payload, ensure_ascii=False)
    + ";\n})(window.App = window.App || {});\n"
)
with open(SEED_OUT, 'w', encoding='utf-8') as fh:
    fh.write(seed_js)

# ---- Resumen ---------------------------------------------------------------
from collections import Counter
by_sub = Counter(p['subcategoryId'] for p in products)
print(f"TOTAL productos: {len(products)}")
print(f"Categorías: {len(categories)}  | Subcategorías usadas: {len(used_subs)}")
for sid, n in sorted(by_sub.items()):
    print(f"  {SUB_DEF[sid][1]:18s} {n}")
print(f"Destacados: {sum(1 for p in products if p['featured'])}  | Nuevos: {sum(1 for p in products if p['isNew'])}")
print(f"Archivo: {OUT}")
print("\n--- Muestras ---")
for p in products[:3] + products[-3:]:
    print(f"[{p['code']}] {p['name']}  ${p['price']:,}".replace(',', '.') + f"  stock={p['stock']}  ({SUB_DEF[p['subcategoryId']][1]})")
