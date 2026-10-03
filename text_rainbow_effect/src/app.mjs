import React from 'react';
import { motion } from 'motion/react';
import { hsvColor, fitScale, interpolateHue } from './color.mjs';

const { createElement: el, useState, useRef, useEffect, useLayoutEffect } = React;
const DEFAULTS = { text: '雨\n水', fontSize: 18, fontWeight: 700, steps: 20, opacity: .6, saturation: .3, value: .95, leftHue: 180, rightHue: -140, lightColor: '#f0ebe2', darkColor: '#000000', blend: 'multiply' };
const BLENDS = [['normal','正常 (Normal)'],['multiply','正片叠底 (Multiply)'],['screen','滤色 (Screen)'],['overlay','叠加 (Overlay)'],['darken','变暗 (Darken)'],['color-burn','加深 (Color Burn)'],['difference','差值 (Difference)']];

export default function App() {
  const [settings, setSettings] = useState({ ...DEFAULTS });
  const [expanded, setExpanded] = useState(false), [dark, setDark] = useState(false);
  const [fit, setFit] = useState(1), [reducedMotion, setReducedMotion] = useState(false);
  const [drafts, setDrafts] = useState({ lightColor: DEFAULTS.lightColor, darkColor: DEFAULTS.darkColor });
  const [numberDrafts, setNumberDrafts] = useState({leftHue:String(DEFAULTS.leftHue), rightHue:String(DEFAULTS.rightHue)});
  const [colorErrors, setColorErrors] = useState({});
  const stage = useRef(null), measure = useRef(null);
  const update = (key, value) => setSettings(previous => ({ ...previous, [key]: value }));
  const foreground = dark ? settings.lightColor : settings.darkColor;
  const background = dark ? settings.darkColor : settings.lightColor;

  useEffect(() => {
    const query = matchMedia('(prefers-reduced-motion: reduce)');
    const sync = () => setReducedMotion(query.matches);
    sync(); query.addEventListener('change', sync);
    return () => query.removeEventListener('change', sync);
  }, []);
  useLayoutEffect(() => {
    let alive = true;
    const resize = () => {
      if (!alive || !stage.current || !measure.current) return;
      setFit(fitScale(measure.current.scrollWidth, measure.current.scrollHeight, stage.current.clientWidth, stage.current.clientHeight));
    };
    const observer = new ResizeObserver(resize);
    observer.observe(stage.current); observer.observe(measure.current);
    document.fonts.ready.then(resize); resize();
    return () => { alive = false; observer.disconnect(); };
  }, [settings.text, settings.fontSize, settings.fontWeight]);

  function toggleTheme() {
    const next = !dark; setDark(next);
    // Keep the user's text, typography, chosen hues and colours when changing backgrounds.
    setSettings(previous => ({ ...previous, saturation: next ? .8 : .3, value: next ? .5 : .95, blend: next ? 'screen' : 'multiply' }));
  }
  function reset() {
    setSettings({ ...DEFAULTS }); setDark(false); setExpanded(false);
    setDrafts({ lightColor: DEFAULTS.lightColor, darkColor: DEFAULTS.darkColor }); setColorErrors({});
    setNumberDrafts({leftHue:String(DEFAULTS.leftHue), rightHue:String(DEFAULTS.rightHue)});
  }
  const lines = () => settings.text.split(/\r?\n/).map((line, index) => el('div', { key: index }, line || '\u00a0'));
  const field = (key, label, type, attrs = {}) => el('div', { className: 'rainbow-field', key },
    el('label', { htmlFor: `rainbow-${key}` }, label),
    el('input', { id: `rainbow-${key}`, type, value: type === 'number' ? numberDrafts[key] : settings[key], ...attrs,
      onBlur: type === 'number' ? () => setNumberDrafts(previous => ({...previous, [key]:String(settings[key])})) : undefined,
      onChange: event => {
        if (type === 'number') setNumberDrafts(previous => ({...previous, [key]:event.target.value}));
        if (event.target.value.trim() === '') return;
        const value = Number(event.target.value);
        if (Number.isFinite(value)) update(key, value);
      } }));
  const range = (key, label, min, max, step = 1) => field(key, `${label} (${settings[key]})`, 'range', {min,max,step});
  const colorField = (key, label) => el('div', { className: 'rainbow-field', key },
    el('label', { htmlFor: `rainbow-${key}` }, label),
    el('input', { id: `rainbow-${key}`, type: 'text', value: drafts[key], spellCheck: false, onChange: event => {
      const value = event.target.value;
      setDrafts(previous => ({ ...previous, [key]: value }));
      if (value.trim() && CSS.supports('color', value) && !/^(inherit|initial|unset|revert|currentcolor|var\()/i.test(value.trim())) {
        update(key, value); setColorErrors(previous => ({...previous,[key]:''}));
      } else setColorErrors(previous => ({...previous,[key]:`${label}：请输入有效颜色，例如 #f0ebe2；预览保留上一次有效颜色。`}));
    } }));
  const section = (title, children) => el('section', null, el('h2', null, title), el('div', {className:'rainbow-fields'}, ...children));

  return el('main', { className: `rainbow-app ${dark ? 'dark' : ''}`, style: { backgroundColor: background, color: foreground } },
    el('div', { className: 'rainbow-toolbar' }, el('button', {type:'button', onClick: reset}, '重置设置'),
      el('button', { type:'button', onClick: toggleTheme }, dark ? '切换亮色背景 (Light Mode)' : '切换深色背景 (Dark Mode)')),
    el('div', { className:'rainbow-stage', ref:stage },
      el('button', { type:'button', className:'rainbow-art-button', onClick:() => setExpanded(!expanded), 'aria-label':expanded ? '收起彩虹文字' : '展开彩虹文字', 'aria-pressed':expanded },
        el('div', { className:'rainbow-stack', style:{ fontWeight:settings.fontWeight, fontSize:`${settings.fontSize}rem`, transform:`scale(${fit})` } },
          el(motion.div, { className:'rainbow-layer', initial:false, animate:{opacity:expanded ? 0 : 1}, transition:{duration:reducedMotion ? 0 : .8}, style:{color:foreground}, 'aria-hidden':true }, ...lines()),
          ...Array.from({length:settings.steps}, (_, index) => {
            const ratio = index / (settings.steps - 1);
            const hue = interpolateHue(settings.leftHue, settings.rightHue, ratio);
            return el(motion.div, { key:index, className:'rainbow-layer', initial:false,
              animate:{scaleX:expanded ? -1 + ratio * 2 : 1, opacity:expanded ? settings.opacity : 0},
              transition:{duration:reducedMotion ? 0 : 1.2, ease:[.16,1,.3,1]},
              style:{color:hsvColor(hue,settings.saturation,settings.value),mixBlendMode:settings.blend,zIndex:settings.steps-Math.round(Math.abs(index-(settings.steps-1)/2))}, 'aria-hidden':true }, ...lines());
          }),
          el('div', { className:'rainbow-measure', ref:measure, 'aria-hidden':true }, ...lines())
        )),
      el('p', {className:'rainbow-text-description'}, settings.text || '空白文字')),
    el('div', {className:'rainbow-controls'},
      el('button', {type:'button',className:'rainbow-expand',style:{backgroundColor:foreground,color:background},onClick:() => setExpanded(!expanded),'aria-pressed':expanded}, expanded ? '往回收 (Collapse)' : '展开特效 (Expand)'),
      el('p', {className:'rainbow-help'}, '点击文字可展开或收起。预览自动适配窗口，保留空格和空行。'),
      el('div', {className:'rainbow-panel'},
        section('1. Typography 排版设置', [
          el('div', {className:'rainbow-field rainbow-text', key:'text'},el('label',{htmlFor:'rainbow-text'},'Text 文字内容（支持多行）'),el('textarea',{id:'rainbow-text',value:settings.text,rows:3,onChange:event=>update('text',event.target.value)})),
          range('fontSize','Font Size 字号 / rem',8,32),range('fontWeight','Font Wt 字重',200,900,100)]),
        section('2. Effects 视觉特效', [range('steps','Steps 分割数',2,50),range('opacity','Opacity 透明度',0,1,.01),range('saturation','Sat (S) 饱和度',0,1,.01),range('value','Val (V) 明度',0,1,.01),field('leftHue','Left Hue 左端色相','number'),field('rightHue','Right Hue 右端色相','number')]),
        section('3. Theme 背景与混合', [el('div',{className:'rainbow-field',key:'blend'},el('label',{htmlFor:'rainbow-blend'},'Blend Mode 模式'),el('select',{id:'rainbow-blend',value:settings.blend,onChange:event=>update('blend',event.target.value)},...BLENDS.map(([value,label])=>el('option',{key:value,value},label)))),colorField('lightColor','Light BG 亮背景'),colorField('darkColor','Dark BG 暗背景')]),
        el('p',{role:'status','aria-live':'polite',className:'rainbow-error'},Object.values(colorErrors).filter(Boolean).join(' ')))));
}
