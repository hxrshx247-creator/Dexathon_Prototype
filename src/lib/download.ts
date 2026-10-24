import { api } from "../api/client";

/** Fetches the chronology PDF and saves it through a temporary link. */
export async function downloadExport(caseId: string) {
  const { blob, filename } = await api.exportCase(caseId);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
