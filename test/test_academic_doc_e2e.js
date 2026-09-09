'use strict';

const pool = require(require('fs').existsSync('./server/db/pool.js') ? './server/db/pool' : '../server/db/pool');
const authService = require(require('fs').existsSync('./server/services/authService.js') ? './server/services/authService' : '../server/services/authService');

async function testGeneration() {
  const adminUser = (await pool.query("SELECT * FROM users WHERE role = 'superadmin' LIMIT 1")).rows[0];
  const token = authService.issueToken(adminUser);

  const docText = `اسم المقرر: أمن نظم قواعد البيانات
اسم مدرس المقرر: م. أحمد شيخة
الكلية: هندسة الذكاء الاصطناعي
القسم: هندسة نظم أمن المعلومات الذكية
الفصل والعام الدراسي: الفصل الصيفي ٢٠٢٥-٢٠٢٦
اسم الكتاب المقرر: يتبع لمقرر النظري

أسابيع الدراسة
العمل المخطط إنجازه 
العمل المنجز فعلاً 
النسبة %
الملاحظات والتعليل
رقم الفصل من الكتاب
نسبة الإنجاز النظرية TR
نسبة الإنجاز الفعلية RR
RR/TR

1
1+2
100%
100%
100%
تم الإنجاز حسب المخطط

2
3+4
100%
100%
100%
تم الإنجاز حسب الخطة

3
5+6
100%
100%
100%
تم الإنجاز حسب المخطط

4
7+8
100%
100%
100%
تم الإنجاز حسب المخطط

5
9+10
100%
100%
100%
تم الإنجاز حسب المخطط

6
مشروع المادة
100%
100%
100%
تم الإنجاز حسب المخطط

7
امتحان العملي
100%
100%
100%
تم الإنجاز حسب المخطط

8
لا يوجد

9
لا يوجد

10
لا يوجد

11
لا يوجد

12
لا يوجد

وسطي النسبة لكامل الفصول المنجزة% AR
100%

تاريخ التقرير: .٢٩/٨/٢٠٢٦
اسم مدرس (منسق) المقرر وتوقيعه: م. أحمد شيخة`;

  const userPrompt = `حلل هذا لي\n\n[محتوى الملف المرفق: تقرير أمن نظم قواعد البيانات.docx]\n\`\`\`\n${docText}\n\`\`\``;

  console.log('[*] إرسال الاستعلام إلى منصة شاهين عبر المسار السيادي الذكي...');
  const res = await fetch('http://127.0.0.1:3001/api/llm/chat', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      messages: [{ role: 'user', content: userPrompt }]
    })
  });

  if (!res.ok) {
    console.error('Chat error:', res.status, await res.text());
    process.exit(1);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let fullOutput = '';
  let routingReceived = null;

  let buffer = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) continue;
      const jsonStr = trimmed.replace(/^data:\s*/, '');
      if (jsonStr === '[DONE]') continue;
      try {
        const parsed = JSON.parse(jsonStr);
        const routing = parsed.choices?.[0]?.delta?.routing;
        if (routing) routingReceived = routing;
        const delta = parsed.choices?.[0]?.delta?.content || '';
        fullOutput += delta;
      } catch (_) {}
    }
  }

  console.log('\n[✓] النموذج المستهدف والتحكيم:', JSON.stringify(routingReceived, null, 2));
  console.log('\n================== مخرجات التحليل الذكية ==================\n');
  console.log(fullOutput);
  console.log('\n===========================================================\n');
  process.exit(0);
}

testGeneration().catch(e => { console.error(e); process.exit(1); });
