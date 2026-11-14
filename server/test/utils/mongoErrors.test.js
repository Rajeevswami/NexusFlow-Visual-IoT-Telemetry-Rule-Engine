import { describe, expect, it } from 'vitest';
import { extractInsertedDocs } from '../../src/utils/mongoErrors.js';

/**
 * `insertMany(..., { ordered: false })` applies what it can and then throws. The
 * ingestion paths recover the durable documents from the error so live data is never
 * silently dropped and the rule engine never evaluates something that is not stored.
 */
describe('extractInsertedDocs', () => {
  it('reads the documents a bulk write still inserted', () => {
    const docs = [{ _id: 'a', value: 1 }, { _id: 'b', value: 2 }];
    expect(extractInsertedDocs({ insertedDocs: docs })).toEqual(docs);
  });

  it('falls back to the driver result shape', () => {
    const docs = [{ _id: 'a' }];
    expect(extractInsertedDocs({ result: { insertedDocs: docs } })).toEqual(docs);
    expect(extractInsertedDocs({ result: { upserted: docs } })).toEqual(docs);
  });

  it('unwraps writeErrors entries that carry a document', () => {
    expect(extractInsertedDocs({ writeErrors: [{ doc: { _id: 'x' } }] })).toEqual([{ _id: 'x' }]);
  });

  it('returns an empty list when nothing was stored', () => {
    expect(extractInsertedDocs(new Error('boom'))).toEqual([]);
    expect(extractInsertedDocs({ insertedDocs: [] })).toEqual([]);
    expect(extractInsertedDocs(undefined)).toEqual([]);
    expect(extractInsertedDocs({ insertedDocs: 'not-an-array' })).toEqual([]);
    expect(extractInsertedDocs({ insertedDocs: [null, 42] })).toEqual([]);
  });
});
