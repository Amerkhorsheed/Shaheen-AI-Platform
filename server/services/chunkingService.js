'use strict';

const { cellToString } = require('../lib/cellValue');

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
  // Rows normally arrive already normalised by the extractor. Converting again
  // is idempotent for a string and keeps a raw ExcelJS value — a rich-text
  // heading, a formula result — from reaching the index as `[object Object]`.
  const s = cellToString(val);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * Normalize Arabic text for invariant semantic matching:
 * - Unifies Alefs (أ, إ, آ -> ا)
 * - Unifies Teh Marbuta and Heh (ة -> ه)
 * - Unifies Yeh and Alef Maqsura (ي, ى -> ي)
 * - Converts Eastern Arabic numerals (٠-٩) to ASCII (0-9)
 * - Removes Arabic Tashkeel / Harakat and Tatweel
 */
function normalizeArabicText(text) {
  if (!text || typeof text !== 'string') return '';
  return text
    .toLowerCase()
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 1632))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 1776))
    .replace(/[أإآ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/[ىي]/g, 'ي')
    .replace(/[\u064B-\u065F\u0640\u0670]/g, '');
}

/**
 * Tokenize a search query or text into searchable word tokens (Arabic & English).
 */
function tokenize(text) {
  if (!text || typeof text !== 'string') return [];
  const normalized = normalizeArabicText(text);
  const rawTokens = normalized
    .replace(/[^\p{L}\p{N}\-_.]+/gu, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 2);

  const tokens = [];
  for (const t of rawTokens) {
    tokens.push(t);
    // Strip Arabic definite article "ال" if length >= 4 (e.g. الالبومين -> البومين)
    if (t.startsWith('ال') && t.length >= 4) {
      tokens.push(t.slice(2));
    }
  }
  return tokens;
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
            for (const t of tokenize(cellToString(cell))) {
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
 * Useful for drill-downs and cross-sheet relational reconciliation.
 */
function searchAllCachedChunks(query, limit = 6) {
  const queryTokens = tokenize(query);
  if (queryTokens.length === 0) return [];

  // 1. Calculate Document Frequency (DF) for query tokens to determine IDF weights
  const dfMap = new Map();
  let totalChunksCount = 0;
  for (const [, manifest] of chunkCache.entries()) {
    if (!manifest.chunks) continue;
    totalChunksCount += manifest.chunks.length;
    for (const chunk of manifest.chunks) {
      const chunkTokensSet = new Set(chunk.tokens);
      for (const q of queryTokens) {
        if (chunkTokensSet.has(q) || chunk.csv.toLowerCase().includes(q)) {
          dfMap.set(q, (dfMap.get(q) || 0) + 1);
        }
      }
    }
  }

  const rareThreshold = Math.max(3, Math.floor(totalChunksCount * 0.08));

  // 2. Score chunks with IDF weight
  const allScored = [];
  for (const [fileHash, manifest] of chunkCache.entries()) {
    if (!manifest.chunks) continue;
    for (const chunk of manifest.chunks) {
      let score = 0;
      const chunkTokensSet = new Set(chunk.tokens);
      const csvLower = chunk.csv.toLowerCase();

      for (const q of queryTokens) {
        const df = dfMap.get(q) || 0;
        // High specificity words (appear in few chunks) get massive weight
        const isRare = df > 0 && df <= rareThreshold;
        const weight = isRare ? 10 : (df > totalChunksCount * 0.4 ? 0.5 : 2);

        if (chunkTokensSet.has(q)) {
          score += weight * 3;
        } else if (csvLower.includes(q)) {
          score += weight * 2.5;
        } else {
          for (const ct of chunk.tokens) {
            if (ct.includes(q) || q.includes(ct)) {
              score += weight * 0.8;
              break;
            }
          }
        }
      }

      if (score >= 2) {
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

  // 3. Relational 2-Hop Foreign Key Resolution across sheets
  if (allScored.length > 0 && limit > 1) {
    const topScored = allScored.slice(0, 4);
    for (const primaryChunk of topScored) {
      // Find code/ID patterns (e.g. PO-1234, BATCH-ALB-9941, HOSP-01, ORD-99)
      const idMatches = primaryChunk.csv.match(/\b[A-Za-z0-9]+-[A-Za-z0-9\-]+\b/g) || [];
      const uniqueIds = Array.from(new Set(idMatches)).slice(0, 5);

      for (const refId of uniqueIds) {
        const refLower = refId.toLowerCase();
        for (const [fileHash, manifest] of chunkCache.entries()) {
          if (!manifest.chunks) continue;
          for (const chunk of manifest.chunks) {
            if (chunk.sheetName !== primaryChunk.sheetName) {
              const matchesCsv = chunk.csv.toLowerCase().includes(refLower);
              const matchesTokens = chunk.tokens.includes(refLower);
              if (matchesCsv || matchesTokens) {
                if (!allScored.some((c) => c.chunkIndex === chunk.chunkIndex && c.sheetName === chunk.sheetName)) {
                  allScored.push({
                    fileHash,
                    chunkIndex: chunk.chunkIndex,
                    sheetName: chunk.sheetName,
                    rowStart: chunk.rowStart,
                    rowEnd: chunk.rowEnd,
                    rowCount: chunk.rowCount,
                    csv: chunk.csv,
                    score: primaryChunk.score + 5 // Boost relational linked chunk!
                  });
                }
              }
            }
          }
        }
      }
    }
  }

  allScored.sort((a, b) => b.score - a.score);

  // If results span multiple sheets, ensure balanced representation
  const sheetsFound = new Set(allScored.map((c) => c.sheetName));
  if (sheetsFound.size > 1 && limit > 2) {
    const balanced = [];
    const perSheetLimit = Math.max(1, Math.ceil(limit / sheetsFound.size));
    const sheetCounts = new Map();

    for (const item of allScored) {
      const current = sheetCounts.get(item.sheetName) || 0;
      if (current < perSheetLimit && balanced.length < limit) {
        balanced.push(item);
        sheetCounts.set(item.sheetName, current + 1);
      }
    }

    // Fill any remainder
    for (const item of allScored) {
      if (balanced.length >= limit) break;
      if (!balanced.includes(item)) balanced.push(item);
    }
    return balanced;
  }

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
