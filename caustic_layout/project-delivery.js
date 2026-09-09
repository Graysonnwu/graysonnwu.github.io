export function projectFilename(title) {
  const name = String(title || "")
    .trim()
    .replace(/[\\/:*?"<>|\x00-\x1f]/g, "-")
    .replace(/^\.+/, "")
    .slice(0, 80);
  return `${name || "我的光路"}.zip`;
}

export function canShareProject(
  file,
  nav = globalThis.navigator,
  secure = globalThis.isSecureContext,
) {
  if (
    !secure ||
    !file ||
    typeof nav?.share !== "function" ||
    typeof nav?.canShare !== "function"
  )
    return false;
  try {
    return nav.canShare({ files: [file] });
  } catch {
    return false;
  }
}

// The file is prepared before this handler is called. Do not await image decode,
// ZIP creation or storage here: Safari requires a fresh user gesture to share.
export async function shareProject(
  file,
  nav = globalThis.navigator,
  secure = globalThis.isSecureContext,
) {
  if (!canShareProject(file, nav, secure)) return { status: "unsupported" };
  try {
    await nav.share({ files: [file] });
    // This means handed to the OS, not delivered to any particular contact.
    return { status: "shared" };
  } catch (error) {
    return {
      status: error.name === "AbortError" ? "cancelled" : "failed",
      error,
    };
  }
}
