import { estimateRelief } from "./relief-core.js";
self.onmessage = ({ data }) => {
  try {
    self.postMessage({ id: data.id, result: estimateRelief(data.input) });
  } catch (error) {
    self.postMessage({
      id: data.id,
      result: { valid: false, reason: "solver", message: error.message },
    });
  }
};
