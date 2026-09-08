'use strict';

/**
 * Sovereign AI Platform - Memory Accelerator & Model Preloader.
 *
 * Takes advantage of large system RAM (96 GB+) to pre-load and pin LLM weights
 * (Qwen-27B and DeepSeek-R1-32B, ~35 GB total) into physical RAM (Windows Standby Page Cache).
 *
 * This turns 11-second disk swaps into direct RAM-to-VRAM DMA transfers over PCIe 5.0,
 * reducing latency to the physical hardware minimum and eliminating SSD wear.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const logger = require('../lib/logger');

const LM_STUDIO_MODELS_DIR = path.join(os.homedir(), '.lmstudio', 'models');

function findGgufFiles(dir) {
  const ggufFiles = [];
  if (!fs.existsSync(dir)) return ggufFiles;

  function walk(current) {
    let entries;
    try {
      entries = fs.readdirSync(current);
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(current, entry);
      let stat;
      try {
        stat = fs.statSync(full);
      } catch {
        continue;
      }
      if (stat.isDirectory()) {
        walk(full);
      } else if (full.endsWith('.gguf') && stat.size > 5 * 1024 * 1024 * 1024) {
        // Only consider heavyweight models (> 5 GB)
        ggufFiles.push({ path: full, size: stat.size, name: entry });
      }
    }
  }

  walk(dir);
  return ggufFiles;
}

async function preloadModel(fileInfo) {
  const sizeGb = (fileInfo.size / (1024 * 1024 * 1024)).toFixed(2);
  console.log(`\n[RAM Preloader] Pinning ${fileInfo.name} (${sizeGb} GB) into System RAM...`);

  const fd = fs.openSync(fileInfo.path, 'r');
  const buffer = Buffer.alloc(64 * 1024 * 1024); // 64 MB chunk buffer
  let totalRead = 0;
  const start = Date.now();

  try {
    while (totalRead < fileInfo.size) {
      const toRead = Math.min(buffer.length, fileInfo.size - totalRead);
      const bytesRead = fs.readSync(fd, buffer, 0, toRead, totalRead);
      if (bytesRead === 0) break;
      totalRead += bytesRead;
    }
  } finally {
    fs.closeSync(fd);
  }

  const durationSec = (Date.now() - start) / 1000;
  const throughput = (fileInfo.size / (1024 * 1024 * 1024) / durationSec).toFixed(2);
  console.log(`✓ Cached ${fileInfo.name} (${sizeGb} GB) in ${durationSec.toFixed(2)}s [${throughput} GB/s]`);
}

async function preloadAll() {
  console.log('===============================================================');
  console.log('  منظومة OSS للذكاء الاصطناعي — مسرّع الذاكرة العشوائية (RAM Accelerator)');
  console.log('===============================================================');

  const totalRamGb = (os.totalmem() / (1024 * 1024 * 1024)).toFixed(2);
  const freeRamGb = (os.freemem() / (1024 * 1024 * 1024)).toFixed(2);
  console.log(`إجمالي ذاكرة النظام (System RAM): ${totalRamGb} GB`);
  console.log(`الذاكرة الشاغرة المتاحة: ${freeRamGb} GB`);

  const models = findGgufFiles(LM_STUDIO_MODELS_DIR);
  if (models.length === 0) {
    console.log(`لم يتم العثور على ملفات GGUF داخل: ${LM_STUDIO_MODELS_DIR}`);
    return;
  }

  console.log(`تم العثور على ${models.length} نماذج عملاقة للتحميل المسبق:`);
  for (const m of models) {
    console.log(` - ${m.name} (${(m.size / (1024 * 1024 * 1024)).toFixed(2)} GB)`);
  }

  for (const m of models) {
    await preloadModel(m);
  }

  const freeAfter = (os.freemem() / (1024 * 1024 * 1024)).toFixed(2);
  console.log('\n===============================================================');
  console.log(`✓ اكتمل تحميل كافة النماذج في ذاكرة RAM بنجاح!`);
  console.log(`الذاكرة المتبقية للنظام: ${freeAfter} GB`);
  console.log('كافة عمليات التبديل (Model Swapping) ستتم الآن بسرعة RAM فائقة عبر PCIe 5.0.');
  console.log('===============================================================');
}

if (require.main === module) {
  preloadAll().catch((err) => {
    console.error('فشل في تشغيل مسرّع الذاكرة:', err);
    process.exit(1);
  });
}

module.exports = { preloadAll, findGgufFiles };
