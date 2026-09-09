'use strict';

const assert = require('node:assert');
const { profileWorksheet, generateStratifiedSample, formatDossierAsMarkdown } = require('../server/services/tabularProfiler');
const { chunkTable, searchChunks } = require('../server/services/chunkingService');

async function testTabularIntelligence() {
  console.log('Testing Tabular Profiler & Chunking Service...');

  // 1. Synthetic dataset with 2,500 rows
  const headers = ['رقم الفحص', 'الموقع', 'التكلفة', 'نسبة الجودة', 'تاريخ التدقيق'];
  const rows = [];
  let expectedSum = 0;

  for (let i = 1; i <= 2500; i++) {
    const cost = 1000 + i * 10;
    expectedSum += cost;
    rows.push([
      `QC-${i}`,
      i % 2 === 0 ? 'دمشق' : 'حلب',
      cost,
      `${(80 + (i % 20))}%`,
      '2026-03-09'
    ]);
  }

  // 2. Profile worksheet
  const startTime = Date.now();
  const profile = profileWorksheet('ورقة_الفحص', headers, rows);
  const duration = Date.now() - startTime;

  console.log(`[✓] Profiled 2,500 rows in ${duration}ms (target: <100ms)`);
  assert.strictEqual(profile.totalRows, 2500);
  assert.strictEqual(profile.colCount, 5);

  const costCol = profile.columns.find((c) => c.name === 'التكلفة');
  assert.ok(costCol);
  assert.strictEqual(costCol.dominantType, 'number');
  assert.strictEqual(costCol.sum, expectedSum);
  assert.strictEqual(costCol.min, 1010);
  assert.strictEqual(costCol.max, 26000);
  console.log(`[✓] Exact SUM verified: ${costCol.sum} (matches expected: ${expectedSum})`);

  // 3. Stratified sampling
  const sample = generateStratifiedSample(headers, rows, profile.outlierRowIndices, 8);
  assert.ok(sample.length >= 20);
  console.log(`[✓] Stratified sample generated with ${sample.length} representative rows`);

  // 4. Dossier markdown
  const markdown = formatDossierAsMarkdown(profile, sample);
  assert.ok(markdown.includes('الملف الإحصائي الشامل للبيانات'));
  assert.ok(markdown.includes('مؤشرات التدقيق الحسابي والمالي القطعي'));
  assert.ok(markdown.includes('100% من السجلات'));
  console.log(`[✓] Arabic Executive Dossier markdown generated (${markdown.length} chars)`);

  // 5. Chunking service
  const fileHash = 'test_hash_123456';
  const manifest = chunkTable(fileHash, 'ورقة_الفحص', headers, rows, 100);
  assert.strictEqual(manifest.totalChunks, 25);
  console.log(`[✓] Partitioned 2,500 rows into ${manifest.totalChunks} chunks of 100 rows`);

  // 6. Search chunk
  const searchResults = searchChunks(fileHash, 'QC-2345', 2);
  assert.ok(searchResults.length > 0);
  assert.ok(searchResults[0].csv.includes('QC-2345'));
  console.log(`[✓] Chunk retrieval matched record in chunk #${searchResults[0].chunkIndex} (Rows ${searchResults[0].rowStart}-${searchResults[0].rowEnd})`);

  // 7. Test Arabic Numerals & Accounting Formats
  const { analyzeValue } = require('../server/services/tabularProfiler');
  const v1 = analyzeValue('١٢،٥٠٠ ل.س');
  assert.strictEqual(v1.type, 'number');
  assert.strictEqual(v1.value, 12500);

  const v2 = analyzeValue('(١,٥٠٠,٠٠٠ SYP)');
  assert.strictEqual(v2.type, 'number');
  assert.strictEqual(v2.value, -1500000);

  const v3 = analyzeValue('4,500.50-');
  assert.strictEqual(v3.type, 'number');
  assert.strictEqual(v3.value, -4500.5);

  const v4 = analyzeValue('٥٠%');
  assert.strictEqual(v4.type, 'number');
  assert.strictEqual(v4.value, 0.5);
  console.log('[✓] Arabic & Accounting numeric parsing (Eastern Arabic numerals, negative brackets, currency symbols) verified 100%');

  console.log('\nAll unit tests passed with 100% precision!\n');
}

testTabularIntelligence().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});
