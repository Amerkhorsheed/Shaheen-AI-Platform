#!/usr/bin/env node
'use strict';

/**
 * Administrator password recovery (break-glass).
 *
 *   npm run reset-admin-password              — defaults to the "admin" account
 *   npm run reset-admin-password -- someuser
 *
 * Issues a random password, prints it once, forces a change at next login and
 * invalidates every existing session for that account. It requires shell
 * access to the server, which is the intended control: there is deliberately
 * no API endpoint that does this.
 */

const userService = require('../services/userService');
const pool = require('../db/pool');
const { NotFoundError } = require('../lib/errors');

async function main() {
  const username = (process.argv[2] || 'admin').trim().toLowerCase();

  const { password } = await userService.resetPassword(username);

  process.stdout.write(
    '\n' +
      '  ┌──────────────────────────────────────────────────────┐\n' +
      '  │  تم تعيين كلمة مرور مؤقتة — تُعرض مرة واحدة فقط      │\n' +
      '  ├──────────────────────────────────────────────────────┤\n' +
      `  │  اسم المستخدم : ${username}\n` +
      `  │  كلمة المرور  : ${password}\n` +
      '  │  يجب تغييرها إلزامياً عند أول تسجيل دخول.            │\n' +
      '  │  أُبطلت جميع الجلسات المفتوحة لهذا الحساب.           │\n' +
      '  └──────────────────────────────────────────────────────┘\n\n'
  );
}

main()
  .then(() => pool.close())
  .then(() => process.exit(0))
  .catch(async (err) => {
    if (err instanceof NotFoundError) {
      process.stderr.write(`${err.message}\n`);
    } else {
      process.stderr.write(`Password reset failed: ${err.message}\n`);
    }
    await pool.close().catch(() => {});
    process.exit(1);
  });
