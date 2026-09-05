const multer = require('multer');
const pdfParse = require('pdf-parse');
const mammoth = require('mammoth');
const XLSX = require('xlsx');

// Setup in-memory upload handler with 50MB file size limit
const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 } // 50MB
});

async function extractTextFromFile(file) {
  const ext = file.originalname.split('.').pop().toLowerCase();
  let extractedText = '';

  try {
    if (ext === 'pdf') {
      const data = await pdfParse(file.buffer);
      extractedText = data.text;
    } else if (ext === 'docx') {
      const result = await mammoth.extractRawText({ buffer: file.buffer });
      extractedText = result.value;
    } else if (['xlsx', 'xls'].includes(ext)) {
      const workbook = XLSX.read(file.buffer, { type: 'buffer' });
      const sheetNames = workbook.SheetNames;
      const sheetsText = sheetNames.map(sheetName => {
        const sheet = workbook.Sheets[sheetName];
        const csv = XLSX.utils.sheet_to_csv(sheet);
        return `### ورقة العمل: ${sheetName}\n\n${csv}`;
      }).join('\n\n---\n\n');
      extractedText = sheetsText;
    } else {
      // Treat as plain text / csv / code / markdown / json (clean UTF-8)
      extractedText = file.buffer.toString('utf-8');
    }

    // Clean up excessive whitespace
    extractedText = extractedText.replace(/\r\n/g, '\n').trim();

    return {
      success: true,
      filename: file.originalname,
      size: file.size,
      mimeType: file.mimetype,
      text: extractedText,
      preview: extractedText.slice(0, 300) + (extractedText.length > 300 ? '...' : '')
    };
  } catch (error) {
    console.error(`Error parsing file ${file.originalname}:`, error);
    return {
      success: false,
      filename: file.originalname,
      error: 'تعذر استخراج النص من هذا الملف: ' + error.message
    };
  }
}

function registerUploadRoutes(app, authMiddleware) {
  // Upload single or multiple files
  app.post('/api/upload', authMiddleware, upload.array('files', 10), async (req, res) => {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'لم يتم إرفاق أي ملفات' });
    }

    const results = [];
    for (const file of req.files) {
      const parsed = await extractTextFromFile(file);
      results.push(parsed);
    }

    res.json({ files: results });
  });
}

module.exports = {
  registerUploadRoutes
};
