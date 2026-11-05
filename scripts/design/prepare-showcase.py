"""Package native browser captures without re-encoding or modifying their content."""
from pathlib import Path
import json
import re
import shutil
from PIL import Image

root = Path(__file__).resolve().parents[2]
showcase = root / 'docs/showcase'
media = root.parent / 'RIWAQ-Media'
media.mkdir(exist_ok=True)

# The browser exports JPEG bytes; give them an accurate extension, preserving bytes.
for path in showcase.glob('*.png'):
    if Image.open(path).format == 'JPEG':
        path.rename(path.with_suffix('.jpg'))

readme = root / 'README.md'
text = readme.read_text(encoding='utf-8')
text = re.sub(r'(docs/showcase/[^\s"()]+)\.png', r'\1.jpg', text)
readme.write_text(text, encoding='utf-8')

manifest = []
for path in sorted(showcase.glob('*.jpg')):
    with Image.open(path) as image:
        manifest.append({'file': path.name, 'width': image.width, 'height': image.height, 'format': image.format})
    shutil.copy2(path, media / path.name)
for name in ['riwaq-mark.svg', 'riwaq-lockup.svg', 'riwaq-icon.png']:
    shutil.copy2(root / 'apps/web/public/brand' / name, media / name)
shutil.copy2(root / 'apps/web/public/brand/riwaq-cover.html', media / 'cover-editable.html')
(showcase / 'manifest.json').write_text(json.dumps(manifest, indent=2), encoding='utf-8')

missing = []
targets = re.findall(r'!?\[[^\]]*\]\(([^)]+)\)', text)
targets += re.findall(r'(?:src|href)="([^"]+)"', text)
for target in targets:
    if target.startswith(('http:', 'https:', '#')):
        continue
    if not (root / target.split('#')[0]).exists():
        missing.append(target)
if missing:
    raise SystemExit('Missing README targets: ' + ', '.join(missing))
print(json.dumps({'images': len(manifest), 'missing_readme_targets': missing, 'media_folder': str(media)}, indent=2))
