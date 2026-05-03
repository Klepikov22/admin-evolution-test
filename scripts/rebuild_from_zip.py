#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Rebuilds data/layers/*.geojson and data/manifest.json from a ZIP archive
containing GeoJSON files exported from ArcGIS Pro.

Usage:
    python scripts/rebuild_from_zip.py GeoJSON_Ocean_5M.zip
"""

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import zipfile
from collections import Counter, defaultdict
from pathlib import Path

CYR_TO_LAT = {
    'а': 'a', 'б': 'b', 'в': 'v', 'г': 'g', 'д': 'd', 'е': 'e', 'ё': 'e',
    'ж': 'zh', 'з': 'z', 'и': 'i', 'й': 'y', 'к': 'k', 'л': 'l', 'м': 'm',
    'н': 'n', 'о': 'o', 'п': 'p', 'р': 'r', 'с': 's', 'т': 't', 'у': 'u',
    'ф': 'f', 'х': 'h', 'ц': 'c', 'ч': 'ch', 'ш': 'sh', 'щ': 'sch', 'ъ': '',
    'ы': 'y', 'ь': '', 'э': 'e', 'ю': 'yu', 'я': 'ya',
}

CATEGORY_ORDER = {'admin': 0, 'stats': 1, 'settlements': 2, 'points': 3, 'buffer': 4}


def decode_name(value: str) -> str:
    return re.sub(r'#U([0-9A-Fa-f]{4})', lambda match: chr(int(match.group(1), 16)), value)


def translit(value: str) -> str:
    text = ''.join(CYR_TO_LAT.get(ch, ch) for ch in value.lower())
    text = re.sub(r'[^a-z0-9]+', '_', text)
    text = re.sub(r'_+', '_', text).strip('_')
    return text or 'layer'


def clean_title(filename: str) -> str:
    name = decode_name(os.path.basename(filename))
    name = re.sub(r'\.geojson$', '', name, flags=re.I)
    name = re.sub(r'^\d+_', '', name)
    name = name.replace('_', ' ')
    return re.sub(r'\s+', ' ', name).strip()


def extract_years(title: str) -> list[int]:
    if re.search(r'17\s*век|17век|xvii', title, re.I):
        return [1600]
    found = [int(x) for x in re.findall(r'(?<!\d)(1[6-9]\d{2}|20\d{2})(?!\d)', title)]
    years = []
    for year in found:
        if year not in years:
            years.append(year)
    return years


def year_label(title: str, years: list[int]) -> str:
    if re.search(r'17\s*век|17век|xvii', title, re.I):
        return 'XVII век'
    if not years:
        return 'б/д'
    if len(years) == 1:
        year = str(years[0])
        if re.search(r'после\s*' + year, title, re.I) or re.search(r'после' + year, title, re.I):
            return f'после {year}'
        return year
    if len(years) == 2:
        return f'{years[0]}–{years[1]}'
    return ' / '.join(str(year) for year in years[:4])


def infer_val_type(value) -> str:
    if value is None or value == '':
        return 'null'
    if isinstance(value, bool):
        return 'boolean'
    if isinstance(value, int) and not isinstance(value, bool):
        return 'integer'
    if isinstance(value, float):
        return 'number'
    if isinstance(value, str):
        if re.match(r'^\d{4}-\d{2}-\d{2}', value):
            return 'date'
        return 'string'
    return type(value).__name__


def merge_type(counter: Counter) -> str:
    non_null = {key: val for key, val in counter.items() if key != 'null'}
    if not non_null:
        return 'null'
    if 'string' in non_null:
        return 'string'
    if 'number' in non_null and 'integer' in non_null:
        return 'number'
    if len(non_null) == 1:
        return next(iter(non_null))
    return 'mixed: ' + ', '.join(sorted(non_null))


def extend_bbox(bbox, coords):
    if coords is None or isinstance(coords, (int, float)) or len(coords) == 0:
        return bbox
    if isinstance(coords[0], (int, float)):
        x, y = float(coords[0]), float(coords[1])
        if bbox is None:
            return [x, y, x, y]
        bbox[0] = min(bbox[0], x)
        bbox[1] = min(bbox[1], y)
        bbox[2] = max(bbox[2], x)
        bbox[3] = max(bbox[3], y)
        return bbox
    for item in coords:
        bbox = extend_bbox(bbox, item)
    return bbox


def geom_category(title: str, geoms: Counter) -> str:
    lowered = title.lower()
    if any(geom in geoms for geom in ('Point', 'MultiPoint')) and ('статистика' in lowered or 'население' in lowered):
        return 'stats'
    if 'острог' in lowered and 'buffer' in lowered:
        return 'buffer'
    if ('острог' in lowered or '17 век' in lowered) and any(geom in geoms for geom in ('Point', 'MultiPoint')):
        return 'settlements'
    if any(geom in geoms for geom in ('Point', 'MultiPoint')):
        return 'points'
    return 'admin'


def load_geojson(raw: bytes) -> dict:
    try:
        return json.loads(raw.decode('utf-8-sig'))
    except UnicodeDecodeError:
        return json.loads(raw.decode('utf-8'))


def build(zip_path: Path, project_root: Path) -> None:
    data_dir = project_root / 'data'
    layers_dir = data_dir / 'layers'
    if layers_dir.exists():
        shutil.rmtree(layers_dir)
    layers_dir.mkdir(parents=True, exist_ok=True)

    layers = []
    with zipfile.ZipFile(zip_path) as archive:
        members = [name for name in archive.namelist() if name.lower().endswith('.geojson')]
        members.sort(key=lambda name: int(re.match(r'.*?(\d+)_', os.path.basename(name)).group(1)) if re.match(r'.*?(\d+)_', os.path.basename(name)) else 9999)

        for idx, member in enumerate(members, 1):
            raw = archive.read(member)
            decoded_filename = decode_name(os.path.basename(member))
            title = clean_title(decoded_filename)
            num_match = re.match(r'(\d+)_', os.path.basename(decoded_filename))
            original_order = int(num_match.group(1)) if num_match else idx
            years = extract_years(title)
            sort_year = years[0] if years else 9999
            label = year_label(title, years)
            data_file = f'{original_order:03d}_{translit(title)[:70]}.geojson'
            (layers_dir / data_file).write_bytes(raw)

            geojson = load_geojson(raw)
            features = geojson.get('features') or []
            geoms = Counter()
            field_count = Counter()
            field_types = defaultdict(Counter)
            samples = defaultdict(list)
            bbox = None

            for feature in features:
                geometry = feature.get('geometry')
                if geometry:
                    geoms[geometry.get('type') or 'Unknown'] += 1
                    bbox = extend_bbox(bbox, geometry.get('coordinates'))
                props = feature.get('properties') or {}
                for key, value in props.items():
                    field_count[key] += 1
                    field_types[key][infer_val_type(value)] += 1
                    if value not in (None, '') and len(samples[key]) < 3:
                        sample = str(value)[:80]
                        if sample not in samples[key]:
                            samples[key].append(sample)

            field_names = list(field_count.keys())
            preferred = ['Rayon', 'rayon', 'ADM2', 'Uezd', 'UEZD', 'Name', 'name', 'Gov', 'ADM1', 'Okrug', 'Oblast', 'Cap']
            label_field = next((field for field in preferred if field in field_names), field_names[0] if field_names else None)
            fields = [{
                'name': key,
                'type': merge_type(field_types[key]),
                'filled': int(field_count[key]),
                'fillRate': round(field_count[key] / len(features), 3) if features else 0,
                'samples': samples[key],
            } for key in field_names]

            layers.append({
                'id': f'layer_{original_order:03d}',
                'originalOrder': original_order,
                'title': title,
                'yearLabel': label,
                'sortYear': sort_year,
                'years': years,
                'category': geom_category(title, geoms),
                'file': f'data/layers/{data_file}',
                'originalFile': decoded_filename,
                'featureCount': len(features),
                'geometryTypes': dict(geoms),
                'bbox': bbox,
                'labelField': label_field,
                'fields': fields,
            })

    layers.sort(key=lambda layer: (layer['sortYear'], CATEGORY_ORDER.get(layer['category'], 9), layer['originalOrder']))
    for index, layer in enumerate(layers):
        layer['timelineIndex'] = index

    bbox = None
    for layer in layers:
        b = layer.get('bbox')
        if not b:
            continue
        if bbox is None:
            bbox = b[:]
        else:
            bbox[0] = min(bbox[0], b[0])
            bbox[1] = min(bbox[1], b[1])
            bbox[2] = max(bbox[2], b[2])
            bbox[3] = max(bbox[3], b[3])

    manifest = {
        'title': 'Эволюция административной сетки Западной Сибири',
        'generatedFrom': zip_path.name,
        'layerCount': len(layers),
        'bbox': bbox,
        'layers': layers,
        'categories': {
            'admin': 'Административные границы',
            'stats': 'Статистика / население',
            'settlements': 'Остроги / пункты',
            'points': 'Точечные слои',
            'buffer': 'Буферы',
        },
    }
    (data_dir / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding='utf-8')
    print(f'Готово: {len(layers)} GeoJSON-слоёв, manifest обновлён.')


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument('zip_path', type=Path, help='ZIP archive with GeoJSON files')
    args = parser.parse_args()
    project_root = Path(__file__).resolve().parents[1]
    build(args.zip_path.resolve(), project_root)


if __name__ == '__main__':
    main()
