"""Build the missing real 600 face from a pinned upstream Noto variable font."""
import hashlib
import sys
from pathlib import Path
from urllib.request import urlopen
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont

SOURCE = "https://raw.githubusercontent.com/notofonts/noto-cjk/f8d157532fbfaeda587e826d4cd5b21a49186f7c/Sans/Variable/TTF/NotoSansCJKsc-VF.ttf"
SHA256 = "990c807e79c25662a5a9ecf7f971baeb2bf2eab9a559e5ecf15cdfdb8561d21f"
destination = Path(sys.argv[1])
destination.parent.mkdir(parents=True, exist_ok=True)
source = destination.with_name("noto-variable-source.ttf")
with urlopen(SOURCE, timeout=120) as response:
    data = response.read()
if hashlib.sha256(data).hexdigest() != SHA256:
    raise RuntimeError("Noto source checksum mismatch")
source.write_bytes(data)
font = instantiateVariableFont(TTFont(source), {"wght": 600}, inplace=True)
# Upstream has no named 600 instance. Name this actual interpolation accurately.
names = {1: "Noto Sans CJK SC", 2: "SemiBold", 4: "Noto Sans CJK SC SemiBold",
         6: "NotoSansCJKsc-SemiBold", 16: "Noto Sans CJK SC", 17: "SemiBold"}
for record in font["name"].names:
    if record.nameID in names:
        record.string = names[record.nameID].encode(record.getEncoding())
font["OS/2"].usWeightClass = 600
font.save(destination)
source.unlink()
verified = TTFont(destination)
assert "fvar" not in verified
assert verified["OS/2"].usWeightClass == 600
print("Installed", verified["name"].getDebugName(6), "actual weight", verified["OS/2"].usWeightClass)
