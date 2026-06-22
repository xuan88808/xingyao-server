import readline from 'readline';
import { getDb, hashPassword } from './database.js';

console.log('╔═══════════════════════════════════╗');
console.log('║   星曜AI 管理后台 - 初始化脚本     ║');
console.log('╚═══════════════════════════════════╝\n');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

function ask(q) {
  return new Promise(resolve => rl.question(q, resolve));
}

async function main() {
  try {
    console.log('[1/3] 初始化数据库...');
    const db = getDb();
    console.log('  ✓ 数据库已就绪\n');

    // 检查是否已有管理员
    const existing = db.prepare('SELECT COUNT(*) as c FROM admins').get();
    if (existing.c > 0) {
      console.log('[!] 已存在管理员账号：');
      const admins = db.prepare('SELECT id, username, role, created_at FROM admins').all();
      admins.forEach(a => console.log(`  - ${a.username} (${a.role}) 创建于 ${a.created_at}`));
      console.log('\n如需重置密码，请手动操作数据库或删除 data/xingyao.db 后重新运行。');
      rl.close();
      return;
    }

    console.log('[2/3] 创建超管账号');
    const username = (await ask('  请输入管理员用户名 (默认: admin): ')) || 'admin';
    const password = await ask('  请输入密码 (默认: admin123): ');
    const finalPassword = password || 'admin123';
    const nickname = (await ask('  请输入昵称 (默认: 管理员): ')) || '管理员';

    if (finalPassword.length < 6) {
      console.log('\n⚠️  密码长度不足6位，建议重新设置。');
      rl.close();
      return;
    }

    const passwordHash = hashPassword(finalPassword);

    db.prepare(`
      INSERT INTO admins (username, password_hash, nickname, role)
      VALUES (?, ?, ?, 'superadmin')
    `).run(username, passwordHash, nickname);

    console.log(`\n[3/3] ✓ 管理员账号创建成功！`);
    console.log(`  用户名: ${username}`);
    console.log(`  密码:   ${finalPassword}`);
    console.log(`  角色:   superadmin`);
    console.log(`\n  登录地址: http://localhost:3001/api/auth/login`);
    console.log(`  管理后台: http://localhost:5173/admin\n`);

  } catch (err) {
    console.error('初始化失败:', err);
  } finally {
    rl.close();
  }
}

main();
