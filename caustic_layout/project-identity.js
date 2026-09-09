// Identity belongs to the design, not a filename, export event or order.
export function newProjectIdentity() {
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 15) | 64;
  b[8] = (b[8] & 63) | 128;
  const h = [...b].map(v => v.toString(16).padStart(2, "0")).join("");
  return {
    id: `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`,
    created_at: new Date().toISOString(),
  };
}

export function validProjectIdentity(p) {
  return p && /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(p.id) &&
    typeof p.created_at === "string" && Number.isFinite(Date.parse(p.created_at));
}

// Sorted keys make the revision independent of JSON property insertion order.
export function canonicalJSON(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJSON).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort()
    .filter(k => value[k] !== undefined)
    .map(k => `${JSON.stringify(k)}:${canonicalJSON(value[k])}`).join(",")}}`;
  return JSON.stringify(value);
}
