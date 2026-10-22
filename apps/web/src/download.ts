/**
 * Browser file helpers for team packages, feature-detected at call time so importing this module is safe
 * during SSR and in tests. Nothing here runs until a person clicks Download / Choose a file.
 */

/** Whether this runtime can build a Blob URL and click a download link. */
export function canDownloadFiles(): boolean {
  return (
    typeof document !== 'undefined' &&
    typeof Blob !== 'undefined' &&
    typeof URL !== 'undefined' &&
    typeof URL.createObjectURL === 'function'
  );
}

/** Saves text as a file. Returns false when the browser cannot (SSR, tests without DOM). */
export function downloadTextFile(filename: string, content: string, mimeType = 'text/markdown;charset=utf-8'): boolean {
  if (!canDownloadFiles()) return false;
  const url = URL.createObjectURL(new Blob([content], { type: mimeType }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.rel = 'noopener';
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  return true;
}

/** Reads a picked package file as text, preferring `File.text()` and falling back to `FileReader`. */
export async function readFileText(file: File): Promise<string> {
  if (typeof file.text === 'function') return file.text();
  if (typeof FileReader !== 'undefined') {
    return new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
      reader.onerror = () => reject(reader.error ?? new Error('The file could not be read'));
      reader.readAsText(file);
    });
  }
  throw new Error('Reading files is not supported in this environment');
}
