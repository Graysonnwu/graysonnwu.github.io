#!/usr/bin/env python3
"""Build standalone local copies; run only when explicitly choosing to sync sources."""
import argparse
from pathlib import Path

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('destination', type=Path, help='Existing _src folder for ass_tools.html and color_correction.html')
args = parser.parse_args()
root = Path(__file__).resolve().parent.parent
source = (root/'index.html').read_text(encoding='utf-8')
for script in ['color-model.js', 'app.js']:
    source = source.replace(f'<script src="{script}"></script>', '<script>\n' + (root/script).read_text(encoding='utf-8') + '\n</script>')
source = source.replace('<a href="calibration/README.md" target="_blank" rel="noopener">可复现色块夹具与测试说明</a>',
                        '可复现色块夹具：GitHub Pages 仓库 ass_tools/calibration/README.md')
destination = args.destination.resolve()
if not destination.is_dir(): raise SystemExit('Destination must already exist')
(destination/'ass_tools.html').write_text(source, encoding='utf-8')
color_only = source.replace("if (location.hash === '#color')", "if (!location.hash || location.hash === '#color')")
(destination/'color_correction.html').write_text(color_only, encoding='utf-8')
print('Updated standalone sources in', destination)
