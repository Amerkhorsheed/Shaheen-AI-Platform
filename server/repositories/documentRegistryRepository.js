'use strict';

const { queryOne } = require('../db/pool');

/**
 * Reserve the next reference number for a year and record the document.
 *
 * The serial is derived and inserted in one statement so two simultaneous
 * exports cannot be handed the same number; the UNIQUE (year, serial)
 * constraint from migration 002 is the backstop.
 */
function insert({ year, prefix, contentSha256, title, classification, kind, issuedBy, issuedByName, model }) {
  return queryOne(
    `WITH next AS (
       SELECT COALESCE(MAX(serial), 0) + 1 AS serial
       FROM document_registry
       WHERE year = $1
     )
     INSERT INTO document_registry
       (ref, year, serial, content_sha256, title, classification, kind, issued_by, issued_by_name, model)
     SELECT
       $2 || '-' || $1::text || '-' || LPAD(next.serial::text, 6, '0'),
       $1, next.serial, $3, $4, $5, $6, $7, $8, $9
     FROM next
     RETURNING ref, serial, year, content_sha256`,
    [year, prefix, contentSha256, title, classification, kind, issuedBy, issuedByName, model]
  );
}

function findByRef(ref) {
  return queryOne(
    `SELECT ref, content_sha256, title, classification, kind, model,
            issued_by_name, created_at
     FROM document_registry
     WHERE ref = $1`,
    [ref]
  );
}

module.exports = { insert, findByRef };
