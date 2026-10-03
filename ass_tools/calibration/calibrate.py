#!/usr/bin/env python3
"""Small, reproducible SDR ASS swatches; never opens or edits real projects."""
import argparse
import hashlib
import json
from pathlib import Path
import statistics
import subprocess

COLORS = ['#000000', '#202020', '#555555', '#AAAAAA', '#E0E0E0', '#FFFFFF',
          '#FF0000', '#00FF00', '#0000FF', '#FFFF00', '#00FFFF', '#FF00FF',
          '#EB8330', '#2980B9', '#D25267', '#705A9A', '#88B04B', '#A67C52',
          '#402020', '#204020', '#202040', '#C0A080', '#80C0A0', '#A080C0']
WIDTH, HEIGHT = 1280, 720

def run(command, binary=False):
    result = subprocess.run(command, check=True, capture_output=True)
    return result.stdout if binary else result.stdout.decode()

def ffmpeg(*args):
    return run(['ffmpeg', '-nostdin', '-hide_banner', '-loglevel', 'error', '-y', *map(str, args)])

def rects():
    return [dict(index=i, ass=color, x=40 + (i % 6) * 200, y=40 + (i // 6) * 170, width=160, height=130)
            for i, color in enumerate(COLORS)]

def write_ass(path, matrix, colors=COLORS):
    header = (f'[Script Info]\nScriptType: v4.00+\nPlayResX: {WIDTH}\nPlayResY: {HEIGHT}\n'
              'ScaledBorderAndShadow: yes\n' + (f'YCbCr Matrix: {matrix}\n' if matrix else '') +
              '\n[V4+ Styles]\nFormat: Name,Fontname,Fontsize,PrimaryColour,SecondaryColour,OutlineColour,BackColour,Bold,Italic,Underline,StrikeOut,ScaleX,ScaleY,Spacing,Angle,BorderStyle,Outline,Shadow,Alignment,MarginL,MarginR,MarginV,Encoding\n'
              'Style: Default,Arial,40,&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,0,0,7,0,0,0,1\n'
              '\n[Events]\nFormat: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text\n')
    lines = []
    for rect, color in zip(rects(), colors):
        bgr = ''.join(reversed([color[1:3], color[3:5], color[5:7]]))
        tags = f'{{\\an7\\pos({rect["x"]},{rect["y"]})\\bord0\\shad0\\1a&H00&\\1c&H{bgr}&\\p1}}'
        drawing = f'm 0 0 l {rect["width"]} 0 {rect["width"]} {rect["height"]} 0 {rect["height"]}'
        lines.append(f'Dialogue: 0,0:00:00.00,0:00:06.00,Default,,0,0,0,,{tags}{drawing}\n')
    path.write_text(header + ''.join(lines), encoding='utf-8')

def sample(path, ffmpeg_options=()):
    info = json.loads(run(['ffprobe', '-v', 'error', '-select_streams', 'v:0', '-show_streams', '-of', 'json', str(path)]))['streams'][0]
    width, height = info['width'], info['height']
    # Explicit decode for video; PNG screenshots retain their stored RGB numbers.
    pixels = run(['ffmpeg', '-nostdin', '-hide_banner', '-loglevel', 'error', '-i', str(path),
                  *ffmpeg_options, '-frames:v', '1', '-pix_fmt', 'rgb24', '-f', 'rawvideo', '-'], binary=True)
    result = []
    for rect in rects():
        cx = int((rect['x'] + rect['width'] / 2) * width / WIDTH)
        cy = int((rect['y'] + rect['height'] / 2) * height / HEIGHT)
        values = [[pixels[(y * width + x) * 3 + c]
                   for y in range(max(0, cy - 5), min(height, cy + 6))
                   for x in range(max(0, cx - 5), min(width, cx + 6))] for c in range(3)]
        rgb = [round(statistics.median(v)) for v in values]
        result.append(dict(ass=rect['ass'], rendered='#' + ''.join(f'{v:02X}' for v in rgb),
                           spread=[max(v) - min(v) for v in values]))
    return result

def generate(output):
    output.mkdir(parents=True, exist_ok=True)
    version = run(['ffmpeg', '-version']).splitlines()[0]
    # Fully tagged limited-range BT.709 source. Rectangles are ASS vector drawings,
    # so center measurements are unaffected by font fallback/antialiasing edges.
    ffmpeg('-f', 'lavfi', '-i', f'color=c=0x303030:s={WIDTH}x{HEIGHT}:r=24:d=6',
           '-vf', 'setparams=colorspace=bt709:color_primaries=bt709:color_trc=bt709:range=limited',
           '-c:v', 'libx264', '-preset', 'fast', '-crf', '18', '-pix_fmt', 'yuv420p',
           '-color_range', 'tv', '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', output/'preview.mp4')
    results = {}
    for label, matrix in [('none', 'None'), ('tv709', 'TV.709'), ('tv601', 'TV.601'), ('missing', None)]:
        write_ass(output/f'{label}.ass', matrix)
        # filename is relative to cwd, avoiding colon/quote escaping in filter paths.
        command = ['ffmpeg', '-nostdin', '-hide_banner', '-loglevel', 'error', '-y', '-i', 'preview.mp4',
                   '-vf', f'ass={label}.ass,scale=in_color_matrix=bt709:in_range=tv:out_range=pc,format=rgb24',
                   '-frames:v', '1', f'ffmpeg-{label}.png']
        subprocess.run(command, cwd=output, check=True, capture_output=True)
        results[label] = sample(output/f'ffmpeg-{label}.png')
    # Sidecar for normal IINA autoload; only the explicitly generated fixture.
    write_ass(output/'preview.ass', 'None')
    subprocess.run(['ffmpeg', '-nostdin', '-hide_banner', '-loglevel', 'error', '-y', '-i', 'preview.mp4',
                    '-vf', 'ass=none.ass', '-c:v', 'libx264', '-preset', 'fast', '-crf', '18', '-pix_fmt', 'yuv420p',
                    '-color_range', 'tv', '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', 'burned.mp4'],
                   cwd=output, check=True, capture_output=True)
    probe = subprocess.run(['ffmpeg', '-nostdin', '-hide_banner', '-i', 'preview.mp4', '-vf', 'ass=none.ass',
                            '-frames:v', '1', '-f', 'null', '-'], cwd=output, check=True, capture_output=True)
    library_log = '\n'.join(line for line in probe.stderr.decode().splitlines() if 'libass' in line or 'Shaper:' in line)
    (output/'libass-version.txt').write_text(library_log + '\n', encoding='utf-8')
    metadata = dict(schema=1, width=WIDTH, height=HEIGHT, rectangles=rects(), ffmpeg=version, libass=library_log,
                    matrix='bt709', range='tv', transfer='bt709', primaries='bt709',
                    subtitleMatrix='None', screenshotSampling='median of center 11x11 pixels', results=results,
                    hashes={p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in output.glob('*') if p.is_file()})
    (output/'measurements.json').write_text(json.dumps(metadata, indent=2), encoding='utf-8')
    profile = dict(schema=1, name='FFmpeg 8.1 BT.709 fixture (not IINA verified)',
                   notes=f'{version}; BT.709 limited, YCbCr Matrix None; native RGB PNG decode; center 11x11 median.',
                   samples=[{k: s[k] for k in ('ass', 'rendered')} for s in results['none']])
    (output/'ffmpeg-profile.json').write_text(json.dumps(profile, indent=2), encoding='utf-8')
    for label, samples in results.items():
        diffs = [abs(int(s['ass'][i:i+2], 16) - int(s['rendered'][i:i+2], 16)) for s in samples for i in (1, 3, 5)]
        print(f'{label}: max channel difference={max(diffs)}; mean absolute={sum(diffs)/len(diffs):.3f}')
    print(output.resolve())

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='command', required=True)
    gen = sub.add_parser('generate'); gen.add_argument('--output', type=Path, default=Path(__file__).parent/'output')
    sam = sub.add_parser('sample'); sam.add_argument('image', type=Path); sam.add_argument('--output', type=Path)
    args = parser.parse_args()
    if args.command == 'generate': generate(args.output.resolve())
    else:
        value = json.dumps(sample(args.image), indent=2)
        if args.output: args.output.write_text(value, encoding='utf-8')
        else: print(value)

if __name__ == '__main__': main()
