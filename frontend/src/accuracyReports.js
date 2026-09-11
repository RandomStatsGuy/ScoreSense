import { parseApiError } from "./format.js";

/** Independent reports run together; only the primary accuracy report is required. */
export async function loadAccuracyReports(position, fetcher) {
  const read = async (path) => {
    const response = await fetcher(path);
    if (!response.ok) throw new Error(await parseApiError(response, "Accuracy report unavailable"));
    return response.json();
  };
  const [accuracy, upside, seasonLong] = await Promise.all([
    read(`/api/accuracy?position=${position}`),
    read(`/api/upside?position=${position}`).catch(() => null),
    read(`/api/accuracy/season-long?position=${position}`).catch(() => null),
  ]);
  return { accuracy, upside, seasonLong };
}
