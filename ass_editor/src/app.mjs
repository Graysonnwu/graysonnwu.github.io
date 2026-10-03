import { React, ReactDOM, ASS } from '../assets/runtime.js';
import { parseASS, parseTime, updateASS, validateEvents } from './ass-document.mjs';
import { decodeASS, encodeASS } from './ass-encoding.mjs';

const h = React.createElement;
const { useState, useEffect, useRef, useMemo } = React;

// Render syntax as text nodes so imported ASS cannot inject HTML into the editor.
function RawEditor({ value, onChange }) {
  const backdrop = useRef(null);
  function highlight(line) {
    if (/^\s*;/.test(line)) return h('span', { className: 'syntax-comment' }, line);
    if (/^\s*\[[^\]]+\]\s*$/.test(line)) return h('span', { className: 'syntax-section' }, line);
    return line.split(/(\{[^}]*\}|\b\d+:\d{2}:\d{2}\.\d+|^\s*(?:Dialogue|Comment|Format|Style)\s*:)/gi).map((part, index) =>
      h('span', { key: index, className: part.startsWith('{') ? 'syntax-tag' : /^\d+:/.test(part) ? 'syntax-time' : /^(?:\s*(?:Dialogue|Comment|Format|Style)\s*:)/i.test(part) ? 'syntax-key' : '' }, part)
    );
  }
  return h('div', { className: 'raw-wrap' },
    h('pre', { ref: backdrop, className: 'raw-highlight', 'aria-hidden': true }, value.replace(/\r\n|\r/g, '\n').split('\n').map((line, index) => h('div', { key: index }, highlight(line) || ' ')), '\n'),
    h('textarea', {
      className: 'raw-editor', value, wrap: 'off', spellCheck: false, 'aria-label': 'ASS 原文',
      placeholder: '导入 ASS 或在这里粘贴完整字幕',
      onChange: event => { const newline = value.match(/\r\n|\r|\n/)?.[0] || '\n'; onChange(event.target.value.replace(/\n/g, newline)); },
      onScroll: event => { if (backdrop.current) { backdrop.current.scrollTop = event.currentTarget.scrollTop; backdrop.current.scrollLeft = event.currentTarget.scrollLeft; } }
    })
  );
}

function App() {
  const [videoFile, setVideoFile] = useState(null);
  const [videoURL, setVideoURL] = useState('');
  const [videoReady, setVideoReady] = useState(false);
  const [source, setSource] = useState('');
  const [filename, setFilename] = useState('subtitles.ass');
  const [encoding, setEncoding] = useState('utf-8');
  const [rawMode, setRawMode] = useState(false);
  const [followPlayback, setFollowPlayback] = useState(true);
  const [currentTime, setCurrentTime] = useState(0);
  const [savedSource, setSavedSource] = useState('');
  const [message, setMessage] = useState('');
  const [previewError, setPreviewError] = useState('');
  const videoRef = useRef(null), previewRef = useRef(null), tableRef = useRef(null);
  const segmentCleanup = useRef(null), importVersion = useRef(0), followedIndex = useRef(-1);
  const document = useMemo(() => parseASS(source), [source]);
  const errors = useMemo(() => [...document.warnings, ...validateEvents(document.events)], [document]);
  const dirty = source !== savedSource;

  useEffect(() => {
    if (!videoFile) return;
    const url = URL.createObjectURL(videoFile);
    setVideoReady(false);
    setCurrentTime(0);
    setVideoURL(url);
    return () => { segmentCleanup.current?.(); URL.revokeObjectURL(url); };
  }, [videoFile]);

  // Each effect owns exactly one renderer. The delay avoids rebuilding it for every keystroke.
  useEffect(() => {
    let renderer = null;
    setPreviewError('');
    if (!videoReady || !source || errors.length || !videoRef.current || !previewRef.current) return;
    const timer = window.setTimeout(() => {
      try {
        renderer = new ASS(source, videoRef.current, { container: previewRef.current, resampling: 'video_height' });
      } catch (error) {
        setPreviewError(`预览失败：${error.message}`);
      }
    }, 250);
    return () => { window.clearTimeout(timer); renderer?.destroy(); };
  }, [source, videoReady, videoURL, errors.length]);

  useEffect(() => {
    const leave = event => { if (dirty) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', leave);
    return () => window.removeEventListener('beforeunload', leave);
  }, [dirty]);

  useEffect(() => {
    const keydown = event => {
      if (!videoRef.current || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      const target = event.target;
      if (target?.closest?.('input, textarea, select, button, [contenteditable="true"]')) return;
      const delta = event.key === 'ArrowLeft' ? -5 : event.key === 'ArrowRight' ? 5 : 0;
      if (!delta || !Number.isFinite(videoRef.current.duration)) return;
      event.preventDefault();
      segmentCleanup.current?.();
      videoRef.current.currentTime = Math.min(videoRef.current.duration, Math.max(0, videoRef.current.currentTime + delta));
    };
    window.addEventListener('keydown', keydown);
    return () => window.removeEventListener('keydown', keydown);
  }, []);

  const activeIndex = document.events.findLastIndex(event => {
    const start = parseTime(event.start), end = parseTime(event.end);
    return currentTime >= start && currentTime < end;
  });
  useEffect(() => {
    if (!followPlayback || rawMode || activeIndex < 0 || activeIndex === followedIndex.current) return;
    if (tableRef.current?.contains(window.document.activeElement)) return;
    followedIndex.current = activeIndex;
    const row = tableRef.current?.querySelector(`[data-index="${activeIndex}"]`);
    if (row) tableRef.current.scrollTo({ top: Math.max(0, row.offsetTop - tableRef.current.clientHeight / 2 + row.offsetHeight / 2), behavior: 'smooth' });
  }, [activeIndex, followPlayback, rawMode]);

  async function importASS(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (dirty && !window.confirm('当前字幕有未导出的修改，仍要导入另一份文件吗？')) return;
    const version = ++importVersion.current;
    try {
      const { source: text, encoding: importedEncoding } = decodeASS(await file.arrayBuffer());
      if (version !== importVersion.current) return;
      const parsed = parseASS(text);
      if (!parsed.events.length) {
        setMessage('文件没有可编辑的 Dialogue 行，可在原文模式检查 [Events] 和 Format。');
        setRawMode(true);
      } else setMessage(`已载入 ${parsed.events.length} 条字幕。`);
      segmentCleanup.current?.();
      setFilename(file.name);
      setEncoding(importedEncoding);
      setSource(text);
      setSavedSource(text);
      followedIndex.current = -1;
    } catch (error) { setMessage(`读取文件失败：${error.message}`); }
  }

  function editEvent(index, key, value) {
    const events = [...document.events];
    events[index] = { ...events[index], [key]: value };
    setSource(updateASS(document, events));
  }

  async function playEvent(event) {
    const video = videoRef.current, start = parseTime(event.start), end = parseTime(event.end);
    if (!video || !videoReady || !Number.isFinite(start) || !Number.isFinite(end) || end <= start) return;
    if (start >= video.duration) { setMessage('这条字幕的开始时间超出视频长度。'); return; }
    segmentCleanup.current?.();
    video.currentTime = start;
    const stop = () => { if (video.currentTime >= end) { video.pause(); cleanup(); } };
    const cleanup = () => { video.removeEventListener('timeupdate', stop); video.removeEventListener('ended', cleanup); segmentCleanup.current = null; };
    segmentCleanup.current = cleanup;
    video.addEventListener('timeupdate', stop);
    video.addEventListener('ended', cleanup);
    try { await video.play(); } catch (error) { cleanup(); setMessage(`播放失败：${error.message}`); }
  }

  function exportASS() {
    const url = URL.createObjectURL(new Blob([encodeASS(source, encoding)], { type: `text/plain;charset=${encoding}` }));
    const link = window.document.createElement('a');
    link.href = url;
    link.download = filename.replace(/\.ass$/i, '') + '_edited.ass';
    window.document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    setSavedSource(source);
    setMessage('已导出字幕，保留原文件的换行、样式、注释和未编辑字段。');
  }

  function cell(event, index, key, label) {
    const present = event._format.some(field => field.toLowerCase() === key);
    const invalid = (key === 'start' || key === 'end') && !Number.isFinite(parseTime(event[key]));
    return h('input', {
      value: event[key], disabled: !present, 'aria-label': `第 ${index + 1} 条${label}`,
      'aria-invalid': invalid, title: present ? label : `此文件的 Format 未定义 ${key}`,
      className: invalid ? 'invalid' : '',
      onChange: e => editEvent(index, key, e.target.value)
    });
  }

  return h('div', { className: 'app' },
    h('header', null,
      h('div', { className: 'brand' }, h('h1', null, 'ASS Studio'), h('span', null, '本地字幕编辑与视频预览')),
      h('div', { className: 'actions' },
        h('label', { className: 'button' }, '载入视频', h('input', { type: 'file', accept: 'video/*', onChange: e => { const file = e.target.files?.[0]; e.target.value = ''; if (file) setVideoFile(file); } })),
        h('label', { className: 'button accent' }, '导入 ASS', h('input', { type: 'file', accept: '.ass,.ssa', onChange: importASS })),
        h('button', { className: 'accent', onClick: exportASS, disabled: !source || errors.length > 0 }, '导出 .ass')
      )
    ),
    h('main', null,
      h('section', { className: 'preview-section', 'aria-label': '视频预览' },
        h('div', { className: 'preview', ref: previewRef },
          videoURL ? h('video', { ref: videoRef, src: videoURL, controls: true, controlsList: 'nofullscreen', onLoadedMetadata: () => setVideoReady(true), onTimeUpdate: e => setCurrentTime(e.target.currentTime), onError: () => { setVideoReady(false); setPreviewError('浏览器无法解码此视频，请转换为浏览器支持的格式。'); } }) : h('p', { className: 'empty' }, '载入本地视频后开始预览')
        ),
        h('div', { className: 'preview-tools' },
          h('p', { className: 'file-info' }, videoFile?.name || '视频与字幕仅在本机浏览器中处理'),
          videoReady && h('button', { onClick: async () => { try { await previewRef.current.requestFullscreen(); } catch (error) { setPreviewError(`无法进入全屏：${error.message}`); } } }, '预览全屏')
        ),
        h('p', { className: 'hint' }, '← / → 跳转 5 秒。网页 ASS.js 预览适合校对文字与时间；复杂特效、字体及最终颜色请以 IINA / FFmpeg 实际渲染为准。'),
        previewError && h('p', { role: 'alert', className: 'error' }, previewError)
      ),
      h('section', { className: 'editor', 'aria-label': '字幕编辑' },
        h('div', { className: 'toolbar' },
          h('div', null, h('strong', null, filename), h('span', { className: 'count' }, `${document.events.length} 条${dirty ? ' · 未导出' : ''}`)),
          h('div', { className: 'view-controls' }, h('label', null, h('input', { type: 'checkbox', checked: followPlayback, onChange: e => { followedIndex.current = -1; setFollowPlayback(e.target.checked); } }), '跟随播放'), h('button', { onClick: () => setRawMode(!rawMode), 'aria-pressed': rawMode }, rawMode ? '表格模式' : '原文模式'))
        ),
        rawMode ? h(RawEditor, { value: source, onChange: setSource }) :
          h('div', { className: 'table-scroll', ref: tableRef }, document.events.length ?
            h('table', null,
              h('thead', null, h('tr', null, ...['层', '开始', '结束', '样式', '文字', '试听'].map(label => h('th', { key: label }, label)))),
              h('tbody', null, document.events.map((event, index) => {
                const start = parseTime(event.start), end = parseTime(event.end);
                const valid = Number.isFinite(start) && Number.isFinite(end) && end > start;
                return h('tr', { key: event.id, 'data-index': index, className: currentTime >= start && currentTime < end ? 'active' : '' },
                  h('td', null, cell(event, index, 'layer', '层')),
                  h('td', null, cell(event, index, 'start', '开始时间')),
                  h('td', null, cell(event, index, 'end', '结束时间')),
                  h('td', null, h('select', { value: event.style, disabled: !event._format.some(field => field.toLowerCase() === 'style'), 'aria-label': `第 ${index + 1} 条样式`, onChange: e => editEvent(index, 'style', e.target.value) }, document.styles.map(style => h('option', { key: style, value: style }, style)))),
                  h('td', null, h('textarea', { value: event.text, rows: Math.min(5, Math.max(2, Math.ceil(event.text.length / 40))), spellCheck: false, 'aria-label': `第 ${index + 1} 条文字`, onChange: e => editEvent(index, 'text', e.target.value) })),
                  h('td', null, h('button', { className: 'play', disabled: !videoReady || !valid, onClick: () => playEvent(event), 'aria-label': `播放第 ${index + 1} 条字幕`, title: '播放本条字幕' }, '▶'))
                );
              }))
            ) : h('p', { className: 'empty' }, '导入 ASS 开始编辑，也可在原文模式粘贴字幕。')
          ),
        errors.length > 0 && h('div', { role: 'alert', className: 'validation' }, `${errors.length} 个格式问题，修正后可导出与预览：`, h('ul', null, errors.slice(0, 5).map((error, i) => h('li', { key: i }, error)))),
        h('div', { className: 'status', role: 'status' }, message || '保留原字幕结构，表格与原文编辑自动同步。')
      )
    )
  );
}

ReactDOM.createRoot(window.document.getElementById('root')).render(h(React.StrictMode, null, h(App)));
