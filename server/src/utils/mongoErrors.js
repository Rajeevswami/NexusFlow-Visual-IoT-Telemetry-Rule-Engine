/**
 * MongoDB bulk-write helpers.
 *
 * `insertMany(..., { ordered: false })` applies every document it can and then throws a
 * bulk-write error describing only the failures. The documents that *were* written are
 * attached to the error; recovering them lets the ingestion path publish exactly what
 * became durable instead of reporting a total failure and dropping live data.
 */

/**
 * Documents that a failed bulk write still managed to insert.
 * @param {unknown} error thrown by insertMany/mongoose
 * @returns {object[]} plain or hydrated documents (possibly empty)
 */
export function extractInsertedDocs(error) {
  const candidates = [
    error?.insertedDocs,
    error?.result?.insertedDocs,
    error?.result?.upserted,
    error?.writeErrors,
  ];
  for (const candidate of candidates) {
    if (!Array.isArray(candidate) || candidate.length === 0) continue;
    const docs = candidate
      .map((entry) => (entry && typeof entry === 'object' && 'doc' in entry ? entry.doc : entry))
      .filter((doc) => doc && typeof doc === 'object');
    if (docs.length > 0) return docs;
  }
  return [];
}
