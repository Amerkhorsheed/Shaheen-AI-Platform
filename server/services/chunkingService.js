'use strict';

/**
 * Sovereign Tabular & Document Semantic Chunking Service.
 *
 * Partitions large datasets into indexed, addressable chunks in memory (RAM),
 * allowing on-demand precision retrieval (drill-downs) without saturating the LLM context.
 */

// LRU Cache for chunk sets (fileHash -> chunkManifest)
const chunkCache = new Map();
const MAX_CACHED_FILES = 500;

function getCachedChunks(fileHash) {
  if (!fileHash) return null;
  const entry = chunkCache.get(fileHash);
  if (entry) {
    chunkCache.delete(fileHash);
    chunkCache.set(fileHash, entry);
    return entry;
  }
  return null;
}

function setCachedChunks(fileHash, manifest) {
  if (!fileHash || !manifest) return;
  if (chunkCache.size >= MAX_CACHED_FILES) {
    const oldestKey = chunkCache.keys().next().value;
    chunkCache.delete(oldestKey);
  }
  chunkCache.set(fileHash, manifest);
}

function clearChunks(fileHash) {
  if (fileHash) chunkCache.delete(fileHash);
}

function escapeCsvCell(val) {
  if (val === null || val === undefined) return '';
  const s = String(val);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * Tokenize a search query or text into searchable word tokens (Arabic & English).
 */
function tokenize(text) {
  if (!text || typeof text !== 'string') return [];
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\-_.]+/gu, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 2);
}

/**
 * Partition table into indexed chunks.
 *
 * @param {string} fileHash
 * @param {string} sheetName
 * @param {string[]} headers
 * @param {Array<Array<any>>} rows
 * @param {number} [chunkSize=100]
 * @returns {object} Manifest with chunks
 */
function chunkTable(fileHash, sheetName, headers, rows, chunkSize = 100) {
  const totalRows = rows.length;
  const chunks = [];
  const headerCsv = headers.map(escapeCsvCell).join(',');

  for (let start = 0; start < totalRows; start += chunkSize) {
    const end = Math.min(start + chunkSize, totalRows);
    const chunkRows = rows.slice(start, end);
    const chunkLines = [headerCsv];

    const tokensSet = new Set();
    for (const h of headers) {
      for (const t of tokenize(h)) tokensSet.add(t);
    }

    for (let r = 0; r < chunkRows.length; r++) {
      const row = chunkRows[r];
      const line = headers.map((_, cIdx) => escapeCsvCell(row ? row[cIdx] : '')).join(',');
      chunkLines.push(line);

      // Tokenize row values for fast inverted search
      if (row) {
        for (const cell of row) {
          if (cell !== null && cell !== undefined) {
            for (const t of tokenize(String(cell))) {
              if (tokensSet.size < 2000) tokensSet.add(t);
            }
          }
        }
      }
    }

    const chunkIndex = chunks.length + 1;
    const csvContent = chunkLines.join('\n');

    chunks.push({
      chunkIndex,
      sheetName,
      rowStart: start + 1,
      rowEnd: end,
      rowCount: chunkRows.length,
      csv: csvContent,
      tokens: Array.from(tokensSet),
      charCount: csvContent.length
    });
  }

  const existing = getCachedChunks(fileHash);
  let allChunks = chunks;
  let allTotalRows = totalRows;
  let sheets = [sheetName];

  if (existing && existing.chunks) {
    const startIdx = existing.chunks.length;
    chunks.forEach((c, idx) => {
      c.chunkIndex = startIdx + idx + 1;
    });
    allChunks = [...existing.chunks, ...chunks];
    allTotalRows = existing.totalRows + totalRows;
    sheets = Array.from(new Set([...(existing.sheets || [existing.sheetName]), sheetName]));
  }

  const manifest = {
    fileHash,
    sheets,
    sheetName,
    totalRows: allTotalRows,
    chunkSize,
    totalChunks: allChunks.length,
    chunks: allChunks
  };

  if (fileHash) {
    setCachedChunks(fileHash, manifest);
  }

  return manifest;
}

/**
 * Search cached chunks for records matching a specific user inquiry or filter.
 *
 * @param {string} fileHash
 * @param {string} query
 * @param {number} [limit=2]
 * @returns {Array<{chunkIndex: number, rowStart: number, rowEnd: number, csv: string, score: number}>}
 */
function searchChunks(fileHash, query, limit = 2) {
  const manifest = getCachedChunks(fileHash);
  if (!manifest || !manifest.chunks || manifest.chunks.length === 0) return [];

  const queryTokens = tokenize(query);
  if (queryTokens.length === 0) return [];

  const scored = [];
  for (const chunk of manifest.chunks) {
    let score = 0;
    const chunkTokensSet = new Set(chunk.tokens);

    for (const q of queryTokens) {
      if (chunkTokensSet.has(q)) {
        score += 3;
      } else {
        // Partial substring match
        for (const ct of chunk.tokens) {
          if (ct.includes(q) || q.includes(ct)) {
            score += 1;
            break;
          }
        }
      }
    }

    if (score > 0) {
      scored.push({
        chunkIndex: chunk.chunkIndex,
        sheetName: chunk.sheetName,
        rowStart: chunk.rowStart,
        rowEnd: chunk.rowEnd,
        rowCount: chunk.rowCount,
        csv: chunk.csv,
        score
      });
    }
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit);
}

/**
 * Search across all currently cached chunk sets for a user query.
 * Useful for drill-downs when a specific row ID or filter is mentioned.
 */
function searchAllCachedChunks(query, limit = 2) {
  const queryTokens = tokenize(query);
  if (queryTokens.length === 0) return [];

  const allScored = [];
  for (const [fileHash, manifest] of chunkCache.entries()) {
    if (!manifest.chunks) continue;
    for (const chunk of manifest.chunks) {
      let score = 0;
      const chunkTokensSet = new Set(chunk.tokens);
      for (const q of queryTokens) {
        if (chunkTokensSet.has(q)) {
          score += 3;
        } else {
          for (const ct of chunk.tokens) {
            if (ct.includes(q) || q.includes(ct)) {
              score += 1;
              break;
            }
          }
        }
      }
      if (score >= 3) {
        allScored.push({
          fileHash,
          chunkIndex: chunk.chunkIndex,
          sheetName: chunk.sheetName,
          rowStart: chunk.rowStart,
          rowEnd: chunk.rowEnd,
          rowCount: chunk.rowCount,
          csv: chunk.csv,
          score
        });
      }
    }
  }

  allScored.sort((a, b) => b.score - a.score);
  return allScored.slice(0, limit);
}

/**
 * Retrieve a specific chunk by index.
 */
function getChunk(fileHash, chunkIndex) {
  const manifest = getCachedChunks(fileHash);
  if (!manifest || !manifest.chunks) return null;
  return manifest.chunks.find((c) => c.chunkIndex === chunkIndex) || null;
}

module.exports = {
  chunkTable,
  searchChunks,
  searchAllCachedChunks,
  getChunk,
  getCachedChunks,
  setCachedChunks,
  clearChunks
};
