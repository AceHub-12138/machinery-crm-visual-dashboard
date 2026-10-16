"""Compare captured static frames after the functional Playwright suite (requires Pillow)."""
import json
from pathlib import Path
from PIL import Image, ImageChops

root = Path('.review/gsap-poc/functional')
results = []
for width in (1920, 3840):
    legacy = Image.open(root / f'static-{width}-legacy.png').convert('RGB')
    gsap = Image.open(root / f'static-{width}-gsap.png').convert('RGB')
    diff = ImageChops.difference(legacy, gsap)
    different = sum(1 for pixel in diff.getdata() if any(pixel))
    histogram = diff.histogram()
    results.append({
        'width': width, 'differentPixels': different,
        'percent': 100 * different / (legacy.width * legacy.height),
        'bounds': diff.getbbox(),
        'channelMAE': sum((i % 256) * n for i, n in enumerate(histogram)) / (legacy.width * legacy.height * 3),
    })
(root / 'pixel-comparison.json').write_text(json.dumps(results, indent=2) + '\n')
print(json.dumps(results))
