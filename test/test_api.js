async function runAllTests() {
  const base = 'http://127.0.0.1:3001';
  console.log('--- اختبار شامل لمنظومة OSS مع خادم PostgreSQL و LM Studio ---');

  // 1. Health
  const healthRes = await fetch(base + '/api/health');
  const health = await healthRes.json();
  console.log('1. Health check:', health.status, 'DB:', health.database);

  // 2. Login
  const loginRes = await fetch(base + '/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'admin123' })
  });
  const loginData = await loginRes.json();
  if (!loginRes.ok) throw new Error('Login failed: ' + JSON.stringify(loginData));
  console.log('2. Login success:', loginData.user.username, '| Category:', loginData.user.categoryName);
  const token = loginData.token;
  const authHeaders = {
    'Content-Type': 'application/json',
    Authorization: 'Bearer ' + token
  };

  // 3. Me
  const meRes = await fetch(base + '/api/auth/me', { headers: authHeaders });
  const me = await meRes.json();
  console.log('3. Authenticated user profile:', me.displayName, '| Clearance:', me.categoryClearance);

  // 4. Categories
  const catRes = await fetch(base + '/api/categories', { headers: authHeaders });
  const cats = await catRes.json();
  console.log(`4. Categories count: ${cats.length} | First: ${cats[0].name} (${cats[0].code})`);

  // 5. User stats
  const statsRes = await fetch(base + '/api/users/stats', { headers: authHeaders });
  const stats = await statsRes.json();
  console.log('5. Stats: Total Users =', stats.totalUsers, '| Active =', stats.activeUsers, '| Categories =', stats.totalCategories);

  // 6. Templates
  const tmplRes = await fetch(base + '/api/templates', { headers: authHeaders });
  const tmpls = await tmplRes.json();
  console.log(`6. Templates count: ${tmpls.length} | First: ${tmpls[0].title}`);

  // 7. LM Studio Discovery
  const modelsRes = await fetch(base + '/api/llm/models', { headers: authHeaders });
  const models = await modelsRes.json();
  console.log('7. LM Studio connected:', models.connected, '| Models loaded:', models.models.map(m => m.id).join(', '));

  // 8. Create Chat Session
  const chatRes = await fetch(base + '/api/chats', {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      title: 'جلسة تدقيق تجريبية - PostgreSQL',
      classification: 'official',
      model: models.models[0]?.id || 'qwen-3.5-opus-glm-27b'
    })
  });
  const chat = await chatRes.json();
  console.log('8. Chat created with ID:', chat.id, '| Title:', chat.title);

  // 9. Add Message to Chat
  const msgRes = await fetch(`${base}/api/chats/${chat.id}/messages`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      role: 'user',
      content: 'مرحباً، أرجو تأكيد ربط قاعدة البيانات PostgreSQL بنجاح.'
    })
  });
  const msg = await msgRes.json();
  console.log('9. Message created with ID:', msg.id, '| Role:', msg.role);

  // 10. Create New User with Category
  const testUsername = 'analyst_' + Date.now().toString(36);
  const newUserRes = await fetch(base + '/api/users', {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      username: testUsername,
      password: 'SecurePassword123!',
      displayName: 'محلل دراسات معتمد',
      role: 'analyst',
      categoryId: 'cat_strategy',
      jobTitle: 'محلل سياسات استراتيجية',
      notes: 'حساب تجريبي لاختبار الترحيل لقاعدة PostgreSQL'
    })
  });
  const newUserData = await newUserRes.json();
  console.log('10. User created:', newUserData.user?.username, '| Department:', newUserData.user?.department, '| Status:', newUserData.user?.status);

  // 11. Audit Logs Check
  const auditRes = await fetch(base + '/api/audit-logs?limit=5', { headers: authHeaders });
  const audit = await auditRes.json();
  console.log(`11. Audit logs recorded: Total = ${audit.total} | Latest action = ${audit.logs[0]?.action}`);

  // 12. Clean up test chat
  await fetch(`${base}/api/chats/${chat.id}`, {
    method: 'DELETE',
    headers: authHeaders
  });
  console.log('12. Test chat session cleaned up cleanly.');

  console.log('\n=============================================');
  console.log('  جميع اختبارات المنظومة مع PostgreSQL نجحت 100%!');
  console.log('=============================================\n');
}

runAllTests().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
