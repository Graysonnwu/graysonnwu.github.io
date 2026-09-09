import { curveTable, defaultAdjustments, grayscaleHistogram } from "./image-adjustments.js";
import { targetCanvas, shadowMask } from "./images.js";
import { validQuad } from "./optics.js";

export function installImageEditor({getImage, getTarget, getShadow, onApply}) {
  const dialog = document.createElement("dialog");
  dialog.className = "image-editor-dialog";
  dialog.setAttribute("aria-labelledby", "imageEditorTitle");
  dialog.innerHTML = `
    <div class="dialog-heading"><h2 id="imageEditorTitle">调整图像</h2><button class="small-square" aria-label="关闭图像编辑器" data-cancel>×</button></div>
    <div class="image-editor-grid">
      <div class="image-preview-panel">
        <div class="image-preview-wrap">
          <canvas id="imageEditPreview" width="384" height="384" aria-label="图像调整预览"></canvas>
          <div id="imageEditHandles">${["左上", "右上", "右下", "左下"].map((label,i)=>`<button class="image-corner" data-corner="${i}" aria-label="${label}角，方向键可微调"></button>`).join("")}</div>
        </div>
        <p class="help-text">拖动四个角，改变图案在投影面内的形状。</p>
        <div class="image-transform-tools"><button class="quiet-button" id="imageRotate">旋转 90°</button><label><input id="imageInvert" type="checkbox">反相</label><button class="text-button" id="resetImageCorners">恢复四角</button></div>
      </div>
      <div class="image-adjust-controls">
        <div class="image-mode"><label>颜色模式 <select id="imageColorMode"><option value="color">原色</option><option value="gray">灰度</option><option value="binary">黑白</option></select></label><label id="thresholdLabel" hidden>阈值 <input id="imageThreshold" type="range" min="0" max="255" value="128"><output id="thresholdValue">128</output></label></div>
        <div class="curve-heading"><span>曲线 · 灰度直方图</span><button class="text-button" id="resetCurve">重置曲线</button></div>
        <canvas id="imageCurve" width="512" height="512" tabindex="0" aria-label="亮度曲线，点击添加控制点，使用方向键调整"></canvas>
        <p class="help-text">点击添加控制点，拖动调整；双击删除。</p>
        <div class="curve-coordinates"><label>输入 <input id="curveInput" type="number" min="0" max="255" step="1"></label><label>输出 <input id="curveOutput" type="number" min="0" max="255" step="1"></label><button class="text-button" id="removeCurvePoint">删除控制点</button></div>
      </div>
    </div>
    <div class="image-editor-footer"><button class="quiet-button" id="resetImageEdits">恢复原图</button><span></span><button class="quiet-button" data-cancel>取消</button><button class="primary-button" id="applyImageEdits">应用</button></div>`;
  document.body.append(dialog);
  const $ = id => dialog.querySelector(`#${id}`);
  const preview = $("imageEditPreview"), graph = $("imageCurve"), ctx = graph.getContext("2d");
  const side = 512, pad = 22, span = side-2*pad;
  let draft, target, original, clip, histogram, selected = 0, dragging = false, frame = 0;
  const handles = [...$("imageEditHandles").children];
  const defaultCorners = () => [[0,0],[1,0],[1,1],[0,1]];
  const interior = () => selected > 0 && selected < draft.curve.length-1;
  const draw = () => {
    frame = 0;
    const x = preview.getContext("2d");
    x.drawImage(targetCanvas(original, {...target, imageAdjustments: draft, clipToShadow: false}, preview.width), 0, 0);
    if (clip) {
      x.globalCompositeOperation = "destination-in"; x.drawImage(clip, 0, 0);
      x.globalCompositeOperation = "destination-over"; x.fillStyle = "black"; x.fillRect(0, 0, preview.width, preview.height);
      x.globalCompositeOperation = "source-over";
    }
    x.strokeStyle = "#a8e4ce"; x.lineWidth = 1; x.setLineDash([5,5]); x.beginPath();
    target.corners.forEach(([u,v],i) => x[i ? "lineTo" : "moveTo"](u*preview.width,v*preview.height));
    x.closePath(); x.stroke(); x.setLineDash([]);
    handles.forEach((handle,i) => {
      handle.style.left = `${target.corners[i][0]*100}%`;
      handle.style.top = `${target.corners[i][1]*100}%`;
    });
    $("imageInvert").checked = target.invert;
    $("imageColorMode").value = draft.mode;
    $("thresholdLabel").hidden = draft.mode !== "binary";
    $("imageThreshold").value = $("thresholdValue").textContent = draft.threshold;
    const point = draft.curve[selected];
    $("curveInput").value = Math.round(point[0]*255);
    $("curveInput").disabled = !interior();
    $("curveOutput").value = Math.round(point[1]*255);
    $("removeCurvePoint").disabled = !interior();
    ctx.clearRect(0,0,side,side);
    ctx.fillStyle = "#131c22"; ctx.fillRect(0,0,side,side);
    // Log height keeps narrow black/white peaks from hiding the middle tones.
    const max = Math.log1p(Math.max(...histogram));
    ctx.fillStyle = "#65757d88";
    for (let i = 0; i < 256; i++) {
      const h = max ? Math.log1p(histogram[i])/max*span : 0;
      ctx.fillRect(pad+i/256*span, side-pad-h, span/256+1, h);
    }
    ctx.lineWidth = 1; ctx.strokeStyle = "#a5b7c02a";
    ctx.beginPath();
    for (let i = 0; i <= 4; i++) {
      const v = pad+i*span/4;
      ctx.moveTo(v,pad); ctx.lineTo(v,side-pad); ctx.moveTo(pad,v); ctx.lineTo(side-pad,v);
    }
    ctx.stroke(); ctx.setLineDash([6,6]); ctx.strokeStyle="#b4c5cb55";
    ctx.beginPath(); ctx.moveTo(pad,side-pad); ctx.lineTo(side-pad,pad); ctx.stroke(); ctx.setLineDash([]);
    const table = curveTable(draft.curve);
    ctx.strokeStyle="#a8e4ce"; ctx.lineWidth=3; ctx.beginPath();
    table.forEach((v,i)=>ctx[i ? "lineTo" : "moveTo"](pad+i/255*span, side-pad-v/255*span)); ctx.stroke();
    draft.curve.forEach(([x,y],i)=>{
      ctx.beginPath(); ctx.arc(pad+x*span, side-pad-y*span, i===selected?8:6,0,Math.PI*2);
      ctx.fillStyle=i===selected?"#e9fff6":"#90cbb8";ctx.fill();ctx.strokeStyle="#14362b";ctx.lineWidth=2;ctx.stroke();
    });
    ctx.fillStyle="#a8b9c0";ctx.font="14px system-ui";ctx.fillText("0",pad-4,side-4);ctx.fillText("255",side-pad-26,side-4);
  };
  const request = () => {if (!frame) frame = requestAnimationFrame(draw);};
  const position = e => {
    const r = graph.getBoundingClientRect(), clamp = v => Math.max(0,Math.min(1,v));
    return [clamp(((e.clientX-r.left)/r.width*side-pad)/span),clamp((side-pad-(e.clientY-r.top)/r.height*side)/span)];
  };
  const nearest = p => draft.curve.findIndex(q=>Math.hypot(p[0]-q[0],p[1]-q[1])<.055);
  const move = p => {
    if (interior()) p[0]=Math.max(draft.curve[selected-1][0]+1/255, Math.min(draft.curve[selected+1][0]-1/255,p[0]));
    else p[0]=draft.curve[selected][0];
    draft.curve[selected]=p; request();
  };
  const remove = () => {if(interior()){draft.curve.splice(selected,1);selected--;request();}};
  graph.onpointerdown = e => {
    e.preventDefault(); const p=position(e); selected=nearest(p);
    if (selected<0) {
      if(draft.curve.length>=16 || p[0]<1/255 || p[0]>254/255) {selected=0;return;}
      if(draft.curve.some(q=>Math.abs(q[0]-p[0])<2/255)) {selected=0;return;}
      draft.curve.push(p);draft.curve.sort((a,b)=>a[0]-b[0]);selected=draft.curve.indexOf(p);
    }
    dragging=true;graph.setPointerCapture(e.pointerId);graph.focus();request();
  };
  graph.onpointermove = e => {if(dragging)move(position(e));};
  graph.onpointerup = graph.onpointercancel = () => {dragging=false;};
  graph.ondblclick = e => {selected=nearest(position(e));if(selected<0)selected=0;remove();};
  graph.onkeydown = e => {
    const d={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,1],ArrowDown:[0,-1]}[e.key];
    if(d){e.preventDefault();move(draft.curve[selected].map((v,i)=>Math.max(0,Math.min(1,v+d[i]*(e.shiftKey?10:1)/255))));}
    if(e.key==="Delete"||e.key==="Backspace"){e.preventDefault();remove();}
  };
  for(const [id,axis] of [["curveInput",0],["curveOutput",1]]) $(id).onchange=e=>{
    const value=Number(e.target.value);if(!Number.isFinite(value))return;
    const p=draft.curve[selected].slice();p[axis]=Math.max(0,Math.min(1,value/255));move(p);
  };
  $("imageColorMode").onchange=e=>{draft.mode=e.target.value;request();};
  $("imageThreshold").oninput=e=>{draft.threshold=Number(e.target.value);request();};
  $("resetCurve").onclick=()=>{draft.curve=defaultAdjustments().curve;selected=0;request();};
  $("resetImageEdits").onclick=()=>{
    draft=defaultAdjustments(); selected=0;
    Object.assign(target, {corners:defaultCorners(),imageRotation:0,invert:false}); request();
  };
  $("imageRotate").onclick=()=>{target.imageRotation=(target.imageRotation+90)%360;request();};
  $("imageInvert").onchange=e=>{target.invert=e.target.checked;request();};
  $("resetImageCorners").onclick=()=>{target.corners=defaultCorners();request();};
  for (const [i,handle] of handles.entries()) {
    let pointer = null;
    const moveCorner = point => {
      const corners=structuredClone(target.corners);
      corners[i]=point.map(v=>Math.max(0,Math.min(1,v)));
      if(validQuad(corners)){target.corners=corners;request();}
    };
    handle.onpointerdown=e=>{e.preventDefault();pointer=e.pointerId;handle.setPointerCapture(pointer);handle.focus();};
    handle.onpointermove=e=>{
      if(pointer!==e.pointerId)return;
      const r=preview.getBoundingClientRect();
      moveCorner([(e.clientX-r.left)/r.width,(e.clientY-r.top)/r.height]);
    };
    handle.onpointerup=handle.onpointercancel=handle.onlostpointercapture=()=>{pointer=null;};
    handle.onkeydown=e=>{
      const delta={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]}[e.key];
      if(delta){e.preventDefault();moveCorner(target.corners[i].map((v,k)=>v+delta[k]*(e.shiftKey ? .05 : .01)));}
    };
  }
  $("removeCurvePoint").onclick=remove;
  dialog.querySelectorAll("[data-cancel]").forEach(b=>b.onclick=()=>dialog.close());
  $("applyImageEdits").onclick=()=>{
    onApply({imageAdjustments:structuredClone(draft),corners:structuredClone(target.corners),imageRotation:target.imageRotation,invert:target.invert});
    dialog.close();
  };
  dialog.addEventListener("close",()=>{dragging=false;cancelAnimationFrame(frame);frame=0;});
  return ()=>{
    target=structuredClone(getTarget());original=getImage();
    draft=structuredClone(target.imageAdjustments||defaultAdjustments());selected=0;
    preview.width=preview.height=window.matchMedia("(max-width: 600px)").matches?256:384;
    clip=target.clipToShadow?shadowMask(target,getShadow(),preview.width):null;
    histogram=grayscaleHistogram(original.getContext("2d",{willReadFrequently:true}).getImageData(0,0,original.width,original.height).data);
    draw();dialog.showModal();
  };
}
