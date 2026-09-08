import {
  prepareMesh,
  createTrace,
  traceBatch,
  finishTrace,
} from "./trace-core.js";
let mesh = null,
  active = 0;
self.onmessage = async ({ data }) => {
  const { id, type } = data;
  if (type === "cancel") {
    active = id;
    return;
  }
  try {
    if (type === "mesh") {
      active = id;
      mesh?.geometry.dispose();
      mesh = prepareMesh(data.mesh);
      self.postMessage({ type: "ready", id });
      return;
    }
    if (type !== "trace" || !mesh) throw new Error("请先导入模型");
    active = id;
    const job = createTrace(mesh, data.state, data.options),
      started = performance.now();
    while (job.done < job.cfg.samples) {
      if (active !== id) return;
      const progress = traceBatch(job, 4096);
      self.postMessage({ type: "progress", id, progress });
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    if (active !== id) return;
    const result = finishTrace(job);
    result.stats.seconds = (performance.now() - started) / 1000;
    self.postMessage({ type: "result", id, ...result }, [result.raster.buffer]);
  } catch (error) {
    self.postMessage({ type: "error", id, message: error.message });
  }
};
