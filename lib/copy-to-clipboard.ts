/**
 * Copy text to the clipboard. Prefer this over ad-hoc `navigator.clipboard.writeText`:
 * - Embedded / IDE preview browsers often deny the Clipboard API; we fall back to
 *   `document.execCommand('copy')` on a temporary textarea.
 * - Do not `await` before calling `writeText` in a click handler — yielding can drop
 *   the transient user activation in some browsers; this helper starts the write
 *   synchronously from your handler.
 */
export function copyTextToClipboard(text: string): Promise<boolean> {
  if (typeof window === 'undefined') {
    return Promise.resolve(false);
  }

  const clip = navigator.clipboard;
  if (clip?.writeText) {
    return clip.writeText(text).then(
      () => true,
      () => Promise.resolve(fallbackCopyText(text))
    );
  }

  return Promise.resolve(fallbackCopyText(text));
}

function fallbackCopyText(text: string): boolean {
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    ta.style.top = '0';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    ta.setSelectionRange(0, text.length);
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}
