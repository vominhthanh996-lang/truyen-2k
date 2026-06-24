import json
import re
from pathlib import Path


ROOT = Path("phe-tho-ta-nhat-duoc-ca-the-gioi")
OUT = Path("doc-truyen-vip/data.js")
AUDIO_DIR = Path("doc-truyen-vip/audio")
AUDIO_VERIFIED = AUDIO_DIR / "verified-audio.json"
AUDIO_PUBLIC_BASE = "https://raw.githubusercontent.com/vominhthanh996-lang/truyen-2k/main/doc-truyen-vip/audio"
REQUIRED_AUDIO_PROVIDER = "edge"
AUDIO_PRESETS = [
    ("nu-cam-xuc", ""),
    ("nam-tram", "-nam-tram"),
]
TITLE_OVERRIDES = {
    "khu-17-ngoai-thanh": "Khu 17 Ngoại Thành",
    "duong-ray-phia-nam": "Đường Ray Phía Nam",
    "ben-trong-buc-tuong": "Bên Trong Bức Tường",
    "phe-do-cam-khu": "Phế Đô Cấm Khu",
    "thanh-moi-tren-phe-tho": "Thành Mới Trên Phế Thổ",
    "giu-cong-tram-so-chin": "Giữ Cổng Trạm Số Chín",
    "bay-ngay-co-lap": "Bảy Ngày Cô Lập",
    "nguoi-chet-ky-ten": "Người Chết Ký Tên",
    "nuoc-xam-khong-mang-co": "Nước Xám Không Mang Cờ",
    "danh-sach-nguoi-con-ten": "Danh Sách Người Còn Tên",
    "thuoc-khong-doi-nguoi": "Thuốc Không Đổi Người",
    "cua-vang-mo-ba-ngay": "Cửa Vàng Mở Ba Ngày",
    "so-chon-nguoi": "Sổ Chọn Người",
    "dau-chan-dan-toi-o-con": "Dấu Chân Dẫn Tới Ổ Con",
    "tram-so-khong-duoi-chan": "Trạm Số Không Dưới Chân",
    "keo-nguoc-day-san-tram": "Kéo Ngược Dây Săn Trạm",
    "duong-bac-khong-mo-cho-nguoi-khong-ten": "Đường Bắc Không Mở Cho Người Không Tên",
    "mieng-ranh-phu-lam-ban": "Miệng Rãnh Phủ Làm Bàn",
    "doi-thu-hoi-den-trong-tieng-go": "Đội Thu Hồi Đến Trong Tiếng Gõ",
}


def natural_key(path: Path):
    return [int(part) if part.isdigit() else part for part in re.split(r"(\d+)", str(path).lower())]


def clean_title(slug: str) -> str:
    slug = re.sub(r"^(tap|phan)-\d+-?", "", slug)
    if slug in TITLE_OVERRIDES:
        return TITLE_OVERRIDES[slug]
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


def verified_audio_files():
    if not AUDIO_VERIFIED.exists():
        return set()
    data = json.loads(AUDIO_VERIFIED.read_text(encoding="utf-8"))
    return {
        str(item.get("file", "")).replace("\\", "/")
        for item in data.get("files", [])
        if item.get("verified") and item.get("provider") == REQUIRED_AUDIO_PROVIDER
    }


def build():
    files = sorted(ROOT.glob("tap-*/ban-v3-dai-than/phan-*.md"), key=natural_key)
    chapters = []
    verified_files = verified_audio_files()

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
            "free": True,
            "price": 0,
            "body": markdown_blocks(text),
        }
        audio_urls = {}
        for preset_id, suffix in AUDIO_PRESETS:
            audio_path = AUDIO_DIR / f"{chapter_id}{suffix}.mp3"
            audio_file = audio_path.name
            if audio_path.exists() and audio_file in verified_files:
                audio_urls[preset_id] = f"{AUDIO_PUBLIC_BASE}/{chapter_id}{suffix}.mp3"
        if audio_urls:
            chapter["audioUrls"] = audio_urls
            if "nu-cam-xuc" in audio_urls:
                chapter["audioUrl"] = audio_urls["nu-cam-xuc"]
        chapters.append(chapter)

    data = {
        "plans": [],
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
