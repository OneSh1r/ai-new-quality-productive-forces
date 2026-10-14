#!/usr/bin/env python
"""Turn the frames from tools/narrate.js into a narrated MP4.

    python tools/build-video.py [video/narration.json] [out.mp4]

Pipeline: Windows speech synthesis (SAPI) speaks one sentence per scene, the
scene's frames are stretched to exactly that length, a caption band is drawn on
every frame, and ffmpeg (from imageio-ffmpeg) muxes H.264 video with AAC audio.
An .srt with the same sentences lands next to the video.
"""
import json
import os
import shutil
import subprocess
import sys
import wave

import imageio_ffmpeg
from PIL import Image, ImageDraw, ImageFont

FFMPEG = imageio_ffmpeg.get_ffmpeg_exe()
VOICE = os.environ.get("PV_VOICE", "Microsoft Huihui Desktop")
RATE = int(os.environ.get("PV_RATE", "1"))       # SAPI rate, -10..10
WIDTH = 1024                                     # output width, height follows
FPS = 12
LEAD_IN = 0.4                                    # seconds of silence before speech
CN_BOLD = r"C:\Windows\Fonts\msyhbd.ttc"
CN_REG = r"C:\Windows\Fonts\msyh.ttc"


def shell():
    """pwsh when available: it reads UTF-8 scripts without a BOM."""
    return shutil.which("pwsh") or "powershell"


def synth(text, wav_path, work):
    """Speak `text` into a wav file with the Windows speech engine."""
    if os.path.exists(wav_path):
        os.remove(wav_path)
    script = os.path.join(work, "say.ps1")
    body = (
        "Add-Type -AssemblyName System.Speech\n"
        "$s = New-Object System.Speech.Synthesis.SpeechSynthesizer\n"
        "try { $s.SelectVoice('" + VOICE + "') } catch { Write-Host \"voice: $_\" }\n"
        "$s.Rate = " + str(RATE) + "\n"
        "$s.SetOutputToWaveFile('" + wav_path.replace("'", "''") + "')\n"
        "$s.Speak('" + text.replace("'", "''") + "')\n"
        "$s.Dispose()\n"
    )
    # a BOM keeps Windows PowerShell from reading Chinese as ANSI
    with open(script, "w", encoding="utf-8-sig") as fh:
        fh.write(body)
    res = subprocess.run([shell(), "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script],
                         capture_output=True, text=True, encoding="utf-8", errors="replace")
    if not os.path.exists(wav_path):
        raise RuntimeError("speech synthesis produced no audio for input: " + text +
                           "\n" + (res.stdout or "") + (res.stderr or ""))


def read_wav(path):
    with wave.open(path, "rb") as fh:
        params = fh.getparams()
        data = fh.readframes(fh.getnframes())
    return params, data


def silence(params, seconds):
    return b"\x00" * int(params.framerate * params.nchannels * params.sampwidth * seconds)


def wrap(text, per_line=42):
    lines, line = [], ""
    for ch in text:
        line += ch
        if len(line) >= per_line and ch in "，。；、：！？,.;:":
            lines.append(line)
            line = ""
    if line:
        lines.append(line)
    return lines


def draw_caption(src, dst, text, fonts):
    """Brand strip on top, screenshot in the middle, caption band at the
    bottom — padding instead of overlaying, so nothing of the app is hidden."""
    zh_font, brand_font = fonts
    img = Image.open(src).convert("RGB")
    ratio = WIDTH / float(img.width)
    img = img.resize((WIDTH, max(1, int(round(img.height * ratio)))), Image.LANCZOS)
    w, h = img.size
    lines = wrap(text)
    band = 26 + len(lines) * 26
    top = 34
    canvas = Image.new("RGB", (w, top + h + band), (10, 12, 20))
    canvas.paste(img, (0, top))
    draw = ImageDraw.Draw(canvas)
    draw.rectangle([0, 0, w, top], fill=(15, 17, 26))
    draw.rectangle([0, top - 3, w, top], fill=(79, 70, 229))
    draw.text((16, 8), "可视化 Pandas · Visual Pandas", font=brand_font, fill=(236, 238, 246))
    y = top + h + 10
    for line in lines:
        draw.text((18, y), line, font=zh_font, fill=(255, 255, 255))
        y += 26
    draw.rectangle([0, top + h, w, top + h + 3], fill=(79, 70, 229))
    canvas.save(dst)


def main():
    manifest_path = sys.argv[1] if len(sys.argv) > 1 else "video/narration.json"
    out_path = sys.argv[2] if len(sys.argv) > 2 else "video/visual-pandas-tour.mp4"
    with open(manifest_path, "r", encoding="utf-8") as fh:
        manifest = json.load(fh)

    root = os.path.dirname(os.path.abspath(manifest_path))
    frames_dir = os.path.join(root, "frames")
    audio_dir = os.path.join(root, "audio")
    cap_dir = os.path.join(root, "captioned")
    for d in (audio_dir, cap_dir):
        os.makedirs(d, exist_ok=True)

    try:
        zh_font = ImageFont.truetype(CN_BOLD, 22)
        brand_font = ImageFont.truetype(CN_REG, 15)
    except OSError:
        zh_font = brand_font = ImageFont.load_default()
    fonts = (zh_font, brand_font)

    gap = float(manifest.get("gap", 0.45))
    params = None
    audio = bytearray()
    timeline = []          # (scene id, start, duration, text)
    concat = []
    clock = 0.0

    for scene in manifest["scenes"]:
        wav_path = os.path.join(audio_dir, scene["id"] + ".wav")
        synth(scene["text"], wav_path, audio_dir)
        p, data = read_wav(wav_path)
        if params is None:
            params = p
            audio += silence(params, LEAD_IN)
            clock = LEAD_IN
        clip = len(data) / float(p.framerate * p.nchannels * p.sampwidth)
        audio += data + silence(params, gap)
        duration = clip + gap
        frames = scene["frames"]
        # the action frames pass quickly, the settled frame stays long enough
        # to read the sentence
        n = len(frames)
        hold_last = min(1.0, duration * 0.45)
        per = max(0.16, (duration - hold_last) / max(1, n - 1)) if n > 1 else duration
        durations = [per] * (n - 1) + [max(0.3, duration - per * (n - 1))]
        scale = duration / sum(durations)
        durations = [d * scale for d in durations]
        for name, dur in zip(frames, durations):
            src = os.path.join(frames_dir, name)
            dst = os.path.join(cap_dir, os.path.splitext(name)[0] + ".png")
            draw_caption(src, dst, scene["text"], fonts)
            concat.append("file '" + dst.replace("\\", "/").replace("'", "'\\''") + "'")
            concat.append("duration %.3f" % dur)
        timeline.append((scene["id"], clock, duration, scene["text"]))
        clock += duration
        print("%-12s speech %.2fs -> scene %.2fs" % (scene["id"], clip, duration))

    concat.append(concat[-2])          # the concat demuxer needs the last file twice
    list_path = os.path.join(root, "concat.txt")
    with open(list_path, "w", encoding="utf-8") as fh:
        fh.write("\n".join(concat) + "\n")

    wav_path = os.path.join(root, "narration.wav")
    with wave.open(wav_path, "wb") as fh:
        fh.setparams(params)
        fh.writeframes(bytes(audio))

    srt_path = os.path.splitext(out_path)[0] + ".srt"
    with open(srt_path, "w", encoding="utf-8") as fh:
        for i, (_, start, dur, text) in enumerate(timeline, 1):
            fh.write("%d\n%s --> %s\n%s\n\n" % (
                i, stamp(start), stamp(start + dur), text))

    cmd = [FFMPEG, "-y", "-hide_banner", "-loglevel", "error",
           "-f", "concat", "-safe", "0", "-i", list_path,
           "-i", wav_path,
           "-vf", "scale=%d:-2:flags=lanczos" % WIDTH,   # captions already at width
           "-r", str(FPS),
           "-c:v", "libx264", "-preset", "medium", "-crf", "24", "-pix_fmt", "yuv420p",
           "-c:a", "aac", "-b:a", "112k", "-ac", "1",
           "-movflags", "+faststart", "-shortest", out_path]
    subprocess.run(cmd, check=True)

    info = subprocess.run([FFMPEG, "-hide_banner", "-i", out_path], capture_output=True, text=True)
    print("\ntarget length: %.1f s" % clock)
    for line in info.stderr.splitlines():
        if "Duration:" in line or "Stream #" in line:
            print("  " + line.strip())
    size = os.path.getsize(out_path) / 1024.0 / 1024.0
    print("wrote %s (%.1f MB) + %s" % (out_path, size, os.path.basename(srt_path)))


def stamp(seconds):
    ms = int(round(seconds * 1000))
    h, ms = divmod(ms, 3600000)
    m, ms = divmod(ms, 60000)
    s, ms = divmod(ms, 1000)
    return "%02d:%02d:%02d,%03d" % (h, m, s, ms)


if __name__ == "__main__":
    main()
