import json
import re
from pathlib import Path


ROOT = Path("phe-tho-ta-nhat-duoc-ca-the-gioi")
OUT = Path("doc-truyen-vip/data.js")
AUDIO_DIR = Path("doc-truyen-vip/audio")
AUDIO_PRESETS = [
    ("nu-cam-xuc", ""),
    ("nam-tram", "-nam-tram"),
    ("nu-cham-am", "-nu-cham-am"),
    ("nam-cang-thang", "-nam-cang-thang"),
    ("nu-nhe-nhang", "-nu-nhe-nhang"),
]


def natural_key(path: Path):
    return [int(part) if part.isdigit() else part for part in re.split(r"(\d+)", str(path).lower())]


def clean_title(slug: str) -> str:
    slug = re.sub(r"^(tap|phan)-\d+-?", "", slug)
    return " ".join(word.capitalize() for word in slug.replace("-", " ").split())


def title_from_text(text: str, fallback: str) -> str:
    for line in text.splitlines():
        stripped = line.strip()
        if stripped.startswith("#"):
            return re.sub(r"^#+\s*", "", stripped).strip()
    return fallback


def markdown_blocks(text: str):
    blocks = []
    for block in re.split(r"\n\s*\n+", text.replace("\ufeff", "").strip()):
        block = block.strip()
        if not block:
            continue
        block = re.sub(r"^#{1,6}\s*", "", block)
        block = re.sub(r"\*\*(.*?)\*\*", r"\1", block)
        block = re.sub(r"\*(.*?)\*", r"\1", block)
        blocks.append(block)
    return blocks


def build():
    files = sorted(ROOT.glob("tap-*/ban-v3-dai-than/phan-*.md"), key=natural_key)
    chapters = []

    for idx, path in enumerate(files, start=1):
        text = path.read_text(encoding="utf-8")
        tap_slug = path.parts[1]
        tap_match = re.search(r"tap-(\d+)", tap_slug)
        tap_no = int(tap_match.group(1)) if tap_match else idx
        tap_title = clean_title(tap_slug)
        phan_title = title_from_text(text, clean_title(path.stem))

        chapter_id = f"c{idx:03d}"
        chapter = {
            "id": chapter_id,
            "title": f"Tập {tap_no:02d}: {tap_title} - {phan_title}",
            "free": idx <= 5,
            "price": 0 if idx <= 5 else 8,
            "body": markdown_blocks(text),
        }
        audio_urls = {}
        for preset_id, suffix in AUDIO_PRESETS:
            audio_path = AUDIO_DIR / f"{chapter_id}{suffix}.mp3"
            if audio_path.exists():
                audio_urls[preset_id] = f"audio/{chapter_id}{suffix}.mp3"
        if audio_urls:
            chapter["audioUrls"] = audio_urls
            if "nu-cam-xuc" in audio_urls:
                chapter["audioUrl"] = audio_urls["nu-cam-xuc"]
        chapters.append(chapter)

    data = {
        "plans": [
            {
                "id": "vip_30",
                "type": "vip",
                "title": "VIP 30 ngày",
                "price": 49000,
                "coins": 0,
                "days": 30,
                "description": "Đọc toàn bộ chương khóa trong 30 ngày.",
            },
            {
                "id": "coins_50",
                "type": "coins",
                "title": "Gói 50 xu",
                "price": 50000,
                "coins": 50,
                "days": 0,
                "description": "Dùng để mở từng chương VIP.",
            },
            {
                "id": "coins_120",
                "type": "coins",
                "title": "Gói 120 xu",
                "price": 100000,
                "coins": 120,
                "days": 0,
                "description": "Tiết kiệm hơn cho độc giả đọc dài kỳ.",
            },
        ],
        "stories": [
            {
                "id": "phe-tho-ta-nhat-duoc-ca-the-gioi",
                "title": "Phế Thổ: Ta Nhặt Được Cả Thế Giới",
                "author": "ThanhMV",
                "status": "Đang ra",
                "genre": ["Phế thổ", "Mạt thế", "Sinh tồn", "Nữ cường"],
                "cover": "linear-gradient(145deg, #d9f99d, #16a34a 45%, #111827)",
                "summary": (
                    "Một cô gái yếu ớt tỉnh lại giữa phế thổ nhiễm xạ, không hệ thống, "
                    "không dị năng, chỉ có trực giác sinh tồn và ý chí nhặt từng mảnh "
                    "thế giới để sống tiếp."
                ),
                "updatedAt": "2026-06-19",
                "reads": 128450,
                "rating": 4.9,
                "chapters": chapters,
            }
        ],
    }

    OUT.write_text(
        "window.STORY_DATA = " + json.dumps(data, ensure_ascii=False, indent=2) + ";\n",
        encoding="utf-8",
    )
    print(f"Generated {len(chapters)} chapters into {OUT} ({OUT.stat().st_size} bytes)")


if __name__ == "__main__":
    build()
