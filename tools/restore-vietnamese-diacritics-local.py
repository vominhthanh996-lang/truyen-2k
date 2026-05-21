import os
os.environ.setdefault("HF_HUB_OFFLINE", "1")
os.environ.setdefault("TRANSFORMERS_OFFLINE", "1")

from pathlib import Path
import re
import sys

ROOT = Path("phe-tho-ta-nhat-duoc-ca-the-gioi")
sys.path.insert(0, str(Path(".deps/nomvn_hf").resolve()))

from nom.text import fix_diacritics  # noqa: E402
from nom.text.diacritic_models import HFDiacriticModel  # noqa: E402


PROPER_REPLACEMENTS = [
    ("Lâm Tích", "Lâm Tịch"),
    ("Lam Tịch", "Lâm Tịch"),
    ("Tân Dã", "Tần Dã"),
    ("Tan Dã", "Tần Dã"),
    ("A Thất", "A Thất"),
    ("Di Mạn", "Di Mạn"),
    ("Lão Phùng", "Lão Phùng"),
    ("Lão Phung", "Lão Phùng"),
    ("Lục Cao", "Lục Cao"),
    ("Tiểu Bảo", "Tiểu Bảo"),
    ("La Kiêu", "La Kiêu"),
    ("La Kiều", "La Kiêu"),
    ("Thạch Cạnh", "Thạch Canh"),
    ("Thạch Canh", "Thạch Canh"),
    ("Hậu Sẹo", "Hậu Sẹo"),
    ("Hau Sẹo", "Hậu Sẹo"),
    ("Ba Đen", "Ba Đen"),
    ("Chuột Vàng", "Chuột Vàng"),
    ("Ngân Thu", "Ngân Thụ"),
    ("Ngân Thủ", "Ngân Thụ"),
    ("Hắc Nhà", "Hắc Nha"),
    ("Hắc Nha", "Hắc Nha"),
    ("Khu 17", "Khu 17"),
    ("Đồi Chim Xám", "Đội Chim Xám"),
    ("Doi Chim Xám", "Đội Chim Xám"),
    ("Đội Chim Xam", "Đội Chim Xám"),
    ("Chim Xam", "Chim Xám"),
    ("phế thỏ", "phế thổ"),
    ("Phế thỏ", "Phế thổ"),
    ("phe thổ", "phế thổ"),
    ("Phe thổ", "Phế thổ"),
    ("tinh thạch", "tinh thạch"),
    ("tĩnh thạch", "tinh thạch"),
    ("tinh thach", "tinh thạch"),
    ("phóng xạ", "phóng xạ"),
    ("bien đổi gen", "biến đổi gen"),
    ("biến đổi gên", "biến đổi gen"),
    ("sụp đổ gen", "sụp đổ gen"),
    ("chó hai hàm", "chó hai hàm"),
    ("Chó hai hàm", "Chó hai hàm"),
    ("chuột răng thép", "chuột răng thép"),
    ("lợn giáp bùn", "lợn giáp bùn"),
    ("nhện ống cống", "nhện ống cống"),
    ("quạ mù", "quạ mù"),
    ("kiến trắng", "kiến trắng"),
    ("thú biến dị", "thú biến dị"),
]

TERM_MAP = {
    "Lam Tich": "Lâm Tịch",
    "Tan Da": "Tần Dã",
    "A That": "A Thất",
    "Di Man": "Di Mạn",
    "Lao Phung": "Lão Phùng",
    "Luc Cao": "Lục Cao",
    "Tieu Bao": "Tiểu Bảo",
    "Tieu Ngo": "Tiểu Ngô",
    "La Kieu": "La Kiêu",
    "Thach Canh": "Thạch Canh",
    "Hau Seo": "Hậu Sẹo",
    "Ba Den": "Ba Đen",
    "Chuot Vang": "Chuột Vàng",
    "Ngan Thu": "Ngân Thụ",
    "Hac Nha": "Hắc Nha",
    "Doi Chim Xam": "Đội Chim Xám",
    "Chim Xam": "Chim Xám",
    "Khu 17": "Khu 17",
    "Dai Nhiem Xa": "Đại Nhiễm Xạ",
    "phe tho": "phế thổ",
    "Phe tho": "Phế thổ",
    "thu bien di": "thú biến dị",
    "Thu bien di": "Thú biến dị",
    "cho hai ham": "chó hai hàm",
    "Cho hai ham": "Chó hai hàm",
    "chuot rang thep": "chuột răng thép",
    "lon giap bun": "lợn giáp bùn",
    "nhen ong cong": "nhện ống cống",
    "qua mu": "quạ mù",
    "kien trang": "kiến trắng",
    "tinh thach": "tinh thạch",
    "phong xa": "phóng xạ",
    "chong xa": "chống xạ",
    "khang xa": "kháng xạ",
    "gen sup do": "gen sụp đổ",
    "bien doi gen": "biến đổi gen",
}


def accent_ratio(text: str) -> float:
    letters = re.findall(r"[A-Za-zÀ-ỹĐđ]", text)
    if not letters:
        return 1.0
    accented = re.findall(r"[À-ỹĐđ]", text)
    return len(accented) / len(letters)


def split_paragraphs(text: str, max_chars: int = 1800):
    parts = re.split(r"(\r?\n\r?\n)", text)
    chunks = []
    current = ""
    for part in parts:
        if len(current) + len(part) > max_chars and current:
            chunks.append(current)
            current = ""
        if len(part) > max_chars:
            if current:
                chunks.append(current)
                current = ""
            for i in range(0, len(part), max_chars):
                chunks.append(part[i : i + max_chars])
        else:
            current += part
    if current:
        chunks.append(current)
    return chunks


def protect_terms(text: str):
    protected = text
    reverse = {}
    for i, (src, dst) in enumerate(sorted(TERM_MAP.items(), key=lambda x: -len(x[0])), 1):
        token = f"XQZTERM{i:03d}X"
        protected = protected.replace(src, token)
        reverse[token] = dst
    return protected, reverse


def postprocess(text: str, reverse=None) -> str:
    out = text
    if reverse:
        for token, dst in reverse.items():
            out = out.replace(token, dst)
            out = out.replace(token.lower(), dst)
            out = out.replace(token.capitalize(), dst)
    for src, dst in PROPER_REPLACEMENTS:
        out = out.replace(src, dst)

    phrase_replacements = {
        "Đại Nhien Xạ": "Đại Nhiễm Xạ",
        "Đại Nhiên Xạ": "Đại Nhiễm Xạ",
        "ngoai thành": "ngoài thành",
        "trong thành": "trong thành",
        "cho đen": "chợ đen",
        "Chợ Đen": "chợ đen",
        "xe lăn": "xe lăn",
        "bánh nén": "bánh nén",
        "thịt hộp": "thịt hộp",
        "bột dinh dưỡng": "bột dinh dưỡng",
        "thuốc kháng xạ": "thuốc kháng xạ",
        "thuốc ổn định gen": "thuốc ổn định gen",
        "nhà máy nước": "nhà máy nước",
        "kho ngầm": "kho ngầm",
        "bão bụi đỏ": "bão bụi đỏ",
        "gió đỏ": "gió đỏ",
        "mưa đen": "mưa đen",
    }
    for src, dst in phrase_replacements.items():
        out = out.replace(src, dst)
    return out


def restore_file(path: Path, model: HFDiacriticModel):
    text = path.read_text(encoding="utf-8")
    if not text.strip():
        return

    # Already-accented prose can be left alone except for term normalization.
    if accent_ratio(text) > 0.08:
        path.write_text(postprocess(text), encoding="utf-8", newline="")
        return

    restored = []
    protected_text, reverse = protect_terms(text)
    chunks = split_paragraphs(protected_text)
    for i, chunk in enumerate(chunks, 1):
        print(f"    chunk {i}/{len(chunks)}")
        if not chunk.strip():
            restored.append(chunk)
            continue
        restored.append(fix_diacritics(chunk, model=model))

    path.write_text(postprocess("".join(restored), reverse), encoding="utf-8", newline="")


def main():
    model = HFDiacriticModel()
    files = sorted(ROOT.rglob("*.md"))
    for file in files:
        print(f"Processing {file}")
        restore_file(file, model)


if __name__ == "__main__":
    main()
