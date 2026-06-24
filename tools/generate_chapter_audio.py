import argparse
import asyncio
import json
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path


DATA_JS = Path("doc-truyen-vip/data.js")
OUT_DIR = Path("doc-truyen-vip/audio")
VERIFIED_AUDIO = OUT_DIR / "verified-audio.json"
VIDEO_VOICE_SCRIPT = Path("E:/ThanhMV/auto-video-generator/scripts/generate_voice_edge.py")
DEFAULT_VOICE = "vi-VN-HoaiMyNeural"
MAX_CHARS = 900
EDGE_REQUIRED_PROVIDER = "edge"
for extra_packages in (Path(".python-packages"), Path("E:/ThanhMV/python-packages")):
    if extra_packages.exists():
        sys.path.insert(0, str(extra_packages.resolve()))

VOICE_PRESETS = {
    "nu-cam-xuc": {
        "label": "Hoài My - nữ Việt",
        "voice": "vi-VN-HoaiMyNeural",
        "rate": "-6%",
        "pitch": "+0Hz",
        "suffix": "",
        "video_voice": "vi-female",
        "video_style": "story-emotional",
    },
    "nam-tram": {
        "label": "Nam Minh - nam Việt",
        "voice": "vi-VN-NamMinhNeural",
        "rate": "-8%",
        "pitch": "-4Hz",
        "suffix": "-nam-tram",
        "video_voice": "vi-male",
        "video_style": "wasteland-dark",
    },
}

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")


def log(message):
    print(str(message).encode("utf-8", errors="replace").decode("utf-8", errors="replace"))


def load_data():
    raw = DATA_JS.read_text(encoding="utf-8")
    match = re.match(r"\s*window\.STORY_DATA\s*=\s*(.*);\s*$", raw, re.S)
    if not match:
        raise ValueError(f"Cannot parse {DATA_JS}")
    return json.loads(match.group(1))


def is_verified_provider(chapter_id, preset_id, filename, provider):
    if not VERIFIED_AUDIO.exists():
        return False
    data = json.loads(VERIFIED_AUDIO.read_text(encoding="utf-8"))
    for item in data.get("files", []):
        if (
            item.get("chapterId") == chapter_id
            and item.get("preset") == preset_id
            and item.get("file") == filename
            and item.get("provider") == provider
            and item.get("verified")
        ):
            return True
    return False


def chapter_text(chapter):
    paragraphs = [str(item).strip() for item in chapter.get("body", []) if str(item).strip()]
    return "\n\n".join(paragraphs)


def generate_with_video_voice(chapter, output, preset, overwrite=False):
    if not VIDEO_VOICE_SCRIPT.exists():
        raise RuntimeError(f"Video voice script not found: {VIDEO_VOICE_SCRIPT}")
    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix=f"{chapter['id']}-video-voice-") as temp_name:
        temp_dir = Path(temp_name)
        parts_dir = temp_dir / "parts"
        parts_dir.mkdir(parents=True, exist_ok=True)
        storyboard = temp_dir / "storyboard.json"
        chunks = chapter_chunks(chapter, max_chars=1200)
        scenes = []
        parts = []
        for index, text in enumerate(chunks, start=1):
            part = parts_dir / f"part-{index:03d}.mp3"
            parts.append(part)
            scenes.append(
                {
                    "id": f"{chapter['id']}-{index:03d}",
                    "duration": 30,
                    "audio": str(part.resolve()),
                    "narration": text,
                    "text": chapter["title"],
                    "subtitle": text,
                }
            )
        config = {
            "title": chapter["title"],
            "width": 1080,
            "height": 1920,
            "fps": 30,
            "scenes": scenes,
            "music": None,
        }
        storyboard.write_text(json.dumps(config, ensure_ascii=False, indent=2), encoding="utf-8")
        cmd = [
            sys.executable,
            str(VIDEO_VOICE_SCRIPT),
            "--storyboard",
            str(storyboard),
            "--voice",
            preset["video_voice"],
            "--voice-style",
            preset["video_style"],
        ]
        if overwrite:
            cmd.append("--overwrite")
        subprocess.run(cmd, check=True)
        for part in parts:
            if not part.exists() or part.stat().st_size < 1024:
                raise RuntimeError(f"Generated video voice part missing or too small: {part}")
        temp_output = output.with_suffix(".tmp.mp3")
        if temp_output.exists():
            temp_output.unlink()
        concat_mp3(parts, temp_output)
        if not temp_output.exists() or temp_output.stat().st_size < 1024:
            raise RuntimeError(f"Generated output is too small: {temp_output}")
        temp_output.replace(output)


def chapter_chunks(chapter, max_chars=MAX_CHARS):
    chunks = []
    current = ""
    for paragraph in [str(item).strip() for item in chapter.get("body", []) if str(item).strip()]:
        if len(paragraph) > max_chars:
            sentences = re.split(r"(?<=[.!?。！？…])\s+", paragraph)
        else:
            sentences = [paragraph]
        for part in sentences:
            part = part.strip()
            if not part:
                continue
            candidate = f"{current}\n\n{part}" if current else part
            if len(candidate) > max_chars and current:
                chunks.append(current)
                current = part
            else:
                current = candidate
    if current:
        chunks.append(current)
    return chunks


async def generate_mp3(edge_tts, text, voice, output, rate="+0%", pitch="+0Hz"):
    communicate = edge_tts.Communicate(text, voice, rate=rate, pitch=pitch)
    await communicate.save(str(output))


def concat_mp3(parts, output):
    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        output.write_bytes(b"".join(part.read_bytes() for part in parts))
        return

    list_path = output.with_suffix(".concat.txt")
    list_path.write_text(
        "\n".join(f"file '{part.resolve().as_posix()}'" for part in parts),
        encoding="utf-8",
    )
    cmd = [
        ffmpeg,
        "-y",
        "-hide_banner",
        "-loglevel",
        "error",
        "-f",
        "concat",
        "-safe",
        "0",
        "-i",
        str(list_path),
        "-c",
        "copy",
        str(output),
    ]
    subprocess.run(cmd, check=True)
    list_path.unlink(missing_ok=True)


async def generate_part(edge_tts, text, voice, part, retries, rate, pitch):
    for attempt in range(1, retries + 1):
        try:
            await generate_mp3(edge_tts, text, voice, part, rate=rate, pitch=pitch)
            if part.exists() and part.stat().st_size >= 1024:
                return
        except Exception as exc:
            log(f"    attempt {attempt}/{retries} failed: {exc}")
        if part.exists() and part.stat().st_size < 1024:
            part.unlink()
        await asyncio.sleep(2 * attempt)
    raise RuntimeError(f"Could not generate audio part: {part}")


async def generate_chapter_mp3(
    edge_tts,
    chapter,
    voice,
    output,
    overwrite=False,
    max_chars=MAX_CHARS,
    retries=3,
    rate="+0%",
    pitch="+0Hz",
):
    chunks = chapter_chunks(chapter, max_chars=max_chars)
    output.parent.mkdir(parents=True, exist_ok=True)
    temp_dir = output.parent / ".chunks" / chapter["id"]
    temp_dir.mkdir(parents=True, exist_ok=True)
    parts = []
    for index, text in enumerate(chunks, start=1):
        part = temp_dir / f"part-{index:03d}.mp3"
        if part.exists() and part.stat().st_size >= 1024 and not overwrite:
            log(f"  skip part {index}/{len(chunks)}")
        else:
            log(f"  part {index}/{len(chunks)}")
            await generate_part(edge_tts, text, voice, part, retries, rate, pitch)
        parts.append(part)
    temp_output = output.with_suffix(".tmp.mp3")
    if temp_output.exists():
        temp_output.unlink()
    concat_mp3(parts, temp_output)
    if not temp_output.exists() or temp_output.stat().st_size < 1024:
        raise RuntimeError(f"Generated output is too small: {temp_output}")
    temp_output.replace(output)


async def main():
    parser = argparse.ArgumentParser(description="Generate MP3 audio files for story chapters.")
    parser.add_argument("--chapter", help="Chapter id to generate, for example c001.")
    parser.add_argument("--all", action="store_true", help="Generate every chapter.")
    parser.add_argument("--limit", type=int, default=0, help="Generate at most N chapters.")
    parser.add_argument("--preset", choices=sorted(VOICE_PRESETS), default="nu-cam-xuc", help="Narration voice preset.")
    parser.add_argument("--engine", choices=["video", "direct"], default="video", help="Use free Edge voices through gen-video pipeline or direct Edge TTS.")
    parser.add_argument("--voice", default=DEFAULT_VOICE, help="Edge TTS voice name.")
    parser.add_argument("--rate", help="Edge TTS rate, for example -8% or +2%.")
    parser.add_argument("--pitch", help="Edge TTS pitch, for example -4Hz or +3Hz.")
    parser.add_argument("--max-chars", type=int, default=MAX_CHARS, help="Maximum characters per TTS chunk.")
    parser.add_argument("--retries", type=int, default=3, help="Retries per TTS chunk.")
    parser.add_argument("--overwrite", action="store_true", help="Regenerate existing MP3 files.")
    args = parser.parse_args()

    if not args.all and not args.chapter:
        parser.error("Use --chapter c001 or --all.")

    edge_tts = None
    if args.engine == "direct":
        try:
            import edge_tts as edge_tts_module
            edge_tts = edge_tts_module
        except ImportError as exc:
            raise SystemExit(
                "Missing edge-tts. Install it with: python -m pip install edge-tts"
            ) from exc

    data = load_data()
    chapters = []
    for story in data.get("stories", []):
        for chapter in story.get("chapters", []):
            if args.all or chapter.get("id") == args.chapter:
                chapters.append((story, chapter))

    if args.limit:
        chapters = chapters[: args.limit]

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    preset = VOICE_PRESETS[args.preset]
    voice = args.voice if args.voice != DEFAULT_VOICE else preset["voice"]
    rate = args.rate or preset["rate"]
    pitch = args.pitch or preset["pitch"]
    suffix = preset["suffix"]
    manifest = []
    for story, chapter in chapters:
        chapter_id = chapter["id"]
        output = OUT_DIR / f"{chapter_id}{suffix}.mp3"
        edge_verified = is_verified_provider(chapter_id, args.preset, output.name, EDGE_REQUIRED_PROVIDER)
        if output.exists() and not args.overwrite and edge_verified:
            log(f"skip {chapter_id}: {output}")
        else:
            force_overwrite = args.overwrite or (output.exists() and not edge_verified)
            log(f"generate {chapter_id} [{args.preset} / {preset['label']} / engine={args.engine}]: {chapter['title']}")
            if args.engine == "video":
                generate_with_video_voice(chapter, output, preset, overwrite=force_overwrite)
            else:
                await generate_chapter_mp3(
                    edge_tts,
                    chapter,
                    voice,
                    output,
                    overwrite=force_overwrite,
                    max_chars=args.max_chars,
                    retries=args.retries,
                    rate=rate,
                    pitch=pitch,
                )
        manifest.append(
            {
                "storyId": story["id"],
                "chapterId": chapter_id,
                "title": chapter["title"],
                "preset": args.preset,
                "label": preset["label"],
                "audioUrl": f"audio/{chapter_id}{suffix}.mp3",
            }
        )

    (OUT_DIR / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    log(f"Done. Generated/checked {len(chapters)} chapter audio files.")
    log("Run tools/build_doc_truyen_data.py after generating audio to attach audioUrl fields.")


if __name__ == "__main__":
    asyncio.run(main())
