import argparse
import json
import shutil
import subprocess
from datetime import datetime, timezone
from pathlib import Path


AUDIO_DIR = Path("doc-truyen-vip/audio")
MANIFEST = AUDIO_DIR / "verified-audio.json"
PRESETS = {
    "nu-cam-xuc": "",
    "nam-tram": "-nam-tram",
}


def load_manifest():
    if not MANIFEST.exists():
        return {"files": []}
    return json.loads(MANIFEST.read_text(encoding="utf-8"))


def save_manifest(data):
    data["files"] = sorted(data["files"], key=lambda item: (item["chapterId"], item["preset"]))
    MANIFEST.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def ffprobe(path):
    exe = shutil.which("ffprobe")
    if not exe:
        return None
    result = subprocess.run(
        [
            exe,
            "-v",
            "error",
            "-show_entries",
            "format=duration,size",
            "-of",
            "json",
            str(path),
        ],
        check=True,
        capture_output=True,
        text=True,
        encoding="utf-8",
    )
    return json.loads(result.stdout).get("format", {})


def verify_file(chapter_id, preset, min_size, min_duration, file_prefix=""):
    suffix = PRESETS[preset]
    path = AUDIO_DIR / f"{file_prefix}{chapter_id}{suffix}.mp3"
    if not path.exists():
        raise FileNotFoundError(f"Missing audio file: {path}")
    size = path.stat().st_size
    if size < min_size:
        raise ValueError(f"Audio too small: {path} ({size} bytes)")

    duration = None
    meta = ffprobe(path)
    if meta:
        duration = float(meta.get("duration") or 0)
        if duration < min_duration:
            raise ValueError(f"Audio too short: {path} ({duration:.1f}s)")

    return {
        "chapterId": chapter_id,
        "preset": preset,
        "file": path.name,
        "size": size,
        "duration": duration,
        "provider": "edge",
        "verified": True,
        "verifiedAt": datetime.now(timezone.utc).isoformat(),
    }


def main():
    parser = argparse.ArgumentParser(description="Verify generated MP3 files and mark them safe to publish.")
    parser.add_argument("--chapter", action="append", required=True, help="Chapter id, for example c001. Repeatable.")
    parser.add_argument("--preset", action="append", choices=sorted(PRESETS), help="Preset id. Repeatable. Omit for all presets.")
    parser.add_argument("--story-id", default="", help="Optional story id to store in the manifest entry.")
    parser.add_argument("--file-prefix", default="", help="Prefix for MP3 filenames, for example city-flood-.")
    parser.add_argument("--min-size", type=int, default=100_000, help="Minimum MP3 size in bytes.")
    parser.add_argument("--min-duration", type=float, default=30.0, help="Minimum MP3 duration in seconds when ffprobe exists.")
    args = parser.parse_args()

    presets = args.preset or list(PRESETS)
    manifest = load_manifest()
    entries = {
        (item.get("storyId", ""), item["chapterId"], item["preset"], item["file"]): item
        for item in manifest.get("files", [])
    }

    for chapter_id in args.chapter:
        for preset in presets:
            item = verify_file(chapter_id, preset, args.min_size, args.min_duration, args.file_prefix)
            if args.story_id:
                item["storyId"] = args.story_id
            entries[(item.get("storyId", ""), chapter_id, preset, item["file"])] = item
            duration = item["duration"]
            duration_text = f"{duration:.1f}s" if duration else "unknown duration"
            print(f"verified {item['file']} ({item['size']} bytes, {duration_text})")

    manifest["files"] = list(entries.values())
    save_manifest(manifest)
    print(f"Updated {MANIFEST}")


if __name__ == "__main__":
    main()
