#!/usr/bin/env python3
"""Capture only the generated fixture in a separate IINA instance via mpv IPC."""
import argparse
import hashlib
import json
from pathlib import Path
import socket
import subprocess
import tempfile
import time

from calibrate import sample

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--output', type=Path, default=Path(__file__).parent/'output')
parser.add_argument('--iina-cli', type=Path, default=Path('/Applications/IINA.app/Contents/MacOS/iina-cli'))
args = parser.parse_args()
output = args.output.resolve()
required = ['preview.mp4', 'burned.mp4', 'none.ass', 'tv709.ass', 'tv601.ass', 'missing.ass', 'measurements.json']
if not all((output/name).is_file() for name in required): raise SystemExit('Run calibrate.py generate first.')
if not args.iina_cli.is_file(): raise SystemExit('Installed official IINA CLI not found; nothing installed or changed.')

with tempfile.TemporaryDirectory(prefix='ass-color-') as temporary:
    ipc_path = Path(temporary)/'mpv.sock'
    subprocess.run([str(args.iina_cli), '--no-stdin', '--separate-windows', '--mpv-pause=yes', '--mpv-start=1',
                    '--mpv-sub-ass-override=no', '--mpv-screenshot-format=png', '--mpv-screenshot-tag-colorspace=no',
                    '--mpv-screenshot-high-bit-depth=no', '--mpv-input-ipc-server='+str(ipc_path), str(output/'preview.mp4')], check=True)
    connection = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    connection.settimeout(10)
    deadline = time.monotonic() + 15
    while not ipc_path.exists():
        if time.monotonic() > deadline: raise SystemExit('IINA IPC did not start within 15 seconds.')
        time.sleep(.1)
    connection.connect(str(ipc_path)); reader = connection.makefile()
    request_id = 0

    def command(value):
        global request_id
        request_id += 1
        connection.sendall((json.dumps({'command': value, 'request_id': request_id})+'\n').encode())
        while True:
            line = reader.readline()
            if not line: raise RuntimeError('IINA IPC closed unexpectedly')
            response = json.loads(line)
            if response.get('request_id') == request_id: return response

    def require(value):
        response = command(value)
        if response.get('error') != 'success': raise RuntimeError(str(response))
        return response.get('data')

    def await_video(path):
        deadline = time.monotonic() + 10
        while time.monotonic() < deadline:
            current = command(['get_property', 'path'])
            position = command(['get_property', 'time-pos'])
            if current.get('data') == str(path) and position.get('error') == 'success': return
            time.sleep(.1)
        raise RuntimeError('Fixture video did not become ready')

    def redraw():
        # Loading an ASS track and seeking are asynchronous. Briefly decode new
        # frames before capturing; capturing immediately produced empty frames.
        require(['set_property', 'pause', False]); time.sleep(.25); require(['set_property', 'pause', True])
        require(['get_property', 'time-pos'])

    def capture(name, mode):
        require(['screenshot-to-file', str(output/name), mode])
        values = sample(output/name)
        if values[0]['rendered'] == values[5]['rendered']:
            raise RuntimeError('Capture lacks fixture swatches; do not use these samples')
        return values

    try:
        await_video(output/'preview.mp4')
        properties = {name: command(['get_property', name]) for name in ['mpv-version', 'libass-version', 'video-params',
                      'sub-ass-override', 'sub-ass-vsfilter-color-compat', 'screenshot-tag-colorspace', 'screenshot-sw',
                      'vo', 'icc-profile', 'target-prim', 'target-trc']}
        cases = {}
        for label in ['none', 'tv709', 'tv601', 'missing']:
            require(['sub-add', str(output/f'{label}.ass'), 'select']); redraw()
            cases[label] = capture(f'iina-{label}.png', 'subtitles')
            (output/f'iina-{label}-samples.json').write_text(json.dumps(cases[label], indent=2), encoding='utf-8')
        require(['loadfile', str(output/'burned.mp4'), 'replace']); await_video(output/'burned.mp4')
        require(['set_property', 'sid', 'no']); require(['seek', 1, 'absolute+exact']); redraw()
        burned = capture('iina-burned.png', 'video')
        (output/'iina-burned-samples.json').write_text(json.dumps(burned, indent=2), encoding='utf-8')
        ffmpeg = json.loads((output/'measurements.json').read_text())
        profile = dict(schema=1, name='IINA native screenshot / FFmpeg fixture',
                       notes=f'{ffmpeg["ffmpeg"]}; {properties["mpv-version"]}; BT.709 limited SDR; ASS Matrix None; native IINA subtitles screenshots, screenshot-tag-colorspace=no. Not macOS desktop screenshots or real projects.',
                       samples=[dict(ass=render['ass'], rendered=render['rendered'], preview=preview['rendered'])
                                for preview, render in zip(cases['none'], ffmpeg['results']['none'])])
        (output/'iina-ffmpeg-profile.json').write_text(json.dumps(profile, indent=2), encoding='utf-8')
        record = dict(properties=properties, cases=cases, burned=burned,
                      hashes={p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in output.glob('iina-*.png')})
        (output/'iina-capture.json').write_text(json.dumps(record, indent=2), encoding='utf-8')
        print('Captured all four ASS matrix cases and burned video in', output)
    finally:
        # Quit only the process reached through this unique, generated IPC socket.
        current = command(['get_property', 'path'])
        if current.get('data') in [str(output/'preview.mp4'), str(output/'burned.mp4')]:
            connection.sendall((json.dumps({'command': ['quit']})+'\n').encode())
        reader.close(); connection.close()
