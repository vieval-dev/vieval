"""
Builds the self-hosted Resource Han Rounded SC web font of the viewer.

The viewer's Latin font, Quicksand, is rounded and has no CJK glyphs. Resource Han Rounded (Cyano Hao, SIL OFL 1.1,
https://github.com/CyanoHao/Resource-Han-Rounded) is a rounded Source Han Sans, so Chinese text matches it.

The source font is a 137 MB CFF2 variable font (axes `wght` 200-900 and `ROND` 0-100, default 100), too large to serve.
This script subsets it into unicode-range slices, saves each slice as WOFF2, and writes `index.css` with one
`@font-face` per slice, as Fontsource does, so a page downloads only the slices of the characters it shows.

NOTICE:
The weight axis is shifted down by `WEIGHT_OFFSET` (50): its range becomes 150-850 instead of 200-900, and the named
instances move with it. A browser that asks for `font-weight: 400` then draws the font's own 450 (Book). The design is
lighter than Quicksand at the same weight, so without the shift Chinese text reads a step lighter than the Latin text
beside it. 50 was picked against +0 and +100 in a side-by-side of the viewer's 400 / 500 / 600 text (2026-10-21).
Only the user scale changes: `avar` maps normalized coordinates, so the shapes along the axis stay the same.

NOTICE:
`ROND` is not pinned: `fontTools.varLib.instancer` fails on this font with `InconsistentGlyphOrder` while merging GPOS,
so both axes stay and browsers use the default `ROND` 100 (fully rounded). This costs size: about 19 MB for 101 slices.
Pin it here when the instancer can process the font.

Usage (Python 3.11+, `pip install fonttools brotli`):

    python packages/ui/scripts/buildCjkFont.py <ResourceHanRoundedSC-VF.otf> [--ranges-from <css>]

`--ranges-from` reads the slices' unicode ranges from a CSS file of `@font-face` rules. It defaults to the current
`index.css` of the output directory; the first build used `@fontsource-variable/noto-sans-sc`'s `index.css` (5.3.1).
"""
import argparse
import re
from pathlib import Path

from fontTools import subset
from fontTools.ttLib import TTFont

OUT = Path(__file__).resolve().parent.parent / 'client' / 'src' / 'assets' / 'fonts' / 'resource-han-rounded-sc'
FAMILY = 'Resource Han Rounded SC'
WEIGHT_OFFSET = 50


def shift_weight_axis(font: TTFont, offset: float) -> tuple[float, float]:
    """
    Moves the `wght` axis of `fvar` (and its named instances and STAT values) down by `offset`, so a requested weight
    draws the font's `offset` heavier design. Returns the new axis range for the `@font-face` descriptor.
    """
    axis = next(axis for axis in font['fvar'].axes if axis.axisTag == 'wght')
    axis.minValue -= offset
    axis.defaultValue -= offset
    axis.maxValue -= offset
    for instance in font['fvar'].instances:
        instance.coordinates['wght'] -= offset
    if 'STAT' in font and font['STAT'].table.AxisValueArray is not None:
        index = [a.AxisTag for a in font['STAT'].table.DesignAxisRecord.Axis].index('wght')
        for value in font['STAT'].table.AxisValueArray.AxisValue:
            for attr in ('Value', 'NominalValue', 'RangeMinValue', 'RangeMaxValue'):
                if getattr(value, 'AxisIndex', None) == index and hasattr(value, attr):
                    setattr(value, attr, getattr(value, attr) - offset)
    return axis.minValue, axis.maxValue


def codepoints(ranges: str) -> set[int]:
    """
    Normalizes a CSS `unicode-range` into code points.

    Before:
    - "U+4e00-4e02,U+ff01"

    After:
    - {0x4e00, 0x4e01, 0x4e02, 0xff01}
    """
    points: set[int] = set()
    for part in ranges.split(','):
        part = part.strip().removeprefix('U+').removeprefix('u+')
        if '-' in part:
            start, end = part.split('-')
            points.update(range(int(start, 16), int(end, 16) + 1))
        elif part:
            points.add(int(part, 16))
    return points


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument('source', type=Path)
    parser.add_argument('--ranges-from', type=Path, default=OUT / 'index.css')
    args = parser.parse_args()

    ranges = re.findall(r'unicode-range:\s*([^;]+);', args.ranges_from.read_text())
    print(f'{len(ranges)} slices', flush=True)

    options = subset.Options()
    options.layout_features = ['*']
    options.name_IDs = ['*']
    options.notdef_outline = True
    options.hinting = False

    # Subsetting the 137 MB source once to every slice's characters keeps each slice's pass small.
    union = set().union(*(codepoints(r) for r in ranges))
    font = TTFont(args.source)
    subsetter = subset.Subsetter(options)
    subsetter.populate(unicodes=union)
    subsetter.subset(font)
    weight_min, weight_max = shift_weight_axis(font, WEIGHT_OFFSET)
    base = OUT / '.base.otf'
    OUT.mkdir(parents=True, exist_ok=True)
    font.save(base)

    for old in OUT.glob('*.woff2'):
        old.unlink()
    faces = []
    for index, unicode_range in enumerate(ranges):
        slice_font = TTFont(base)
        slicer = subset.Subsetter(options)
        slicer.populate(unicodes=codepoints(unicode_range))
        slicer.subset(slice_font)
        slice_font.flavor = 'woff2'
        name = f'resource-han-rounded-sc-{index}-wght-normal.woff2'
        slice_font.save(OUT / name)
        faces.append(
            '@font-face {\n'
            f"  font-family: '{FAMILY}';\n"
            '  font-style: normal;\n'
            '  font-display: swap;\n'
            f'  font-weight: {weight_min:g} {weight_max:g};\n'
            f"  src: url(./{name}) format('woff2-variations');\n"
            f'  unicode-range: {unicode_range.strip()};\n'
            '}\n',
        )
    base.unlink()

    header = (
        f'/* {FAMILY} 1.910 (Cyano Hao, SIL OFL 1.1, see LICENSE), sliced by unicode-range for the viewer. */\n'
        '/* Generated by packages/ui/scripts/buildCjkFont.py; do not edit by hand. */\n'
    )
    (OUT / 'index.css').write_text(header + '\n'.join(faces))
    total = sum(path.stat().st_size for path in OUT.glob('*.woff2'))
    print(f'{len(faces)} slices, {total / 1e6:.1f} MB', flush=True)


if __name__ == '__main__':
    main()
