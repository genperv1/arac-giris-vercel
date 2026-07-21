// Tüm IP banlarını temizler (sunucunun kullandığı dosya: banned_ips.json)

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const BAN_LIST_FILE = path.join(__dirname, 'banned_ips.json');

function clearBanList() {
  try {
    fs.writeFileSync(BAN_LIST_FILE, JSON.stringify({}, null, 2), 'utf8');
    console.log('✅ banned_ips.json temizlendi (tüm banlar kaldırıldı)');
    return true;
  } catch (error) {
    console.error('❌ Ban listesi temizleme hatası:', error.message);
    return false;
  }
}

function pushToGitHub() {
  try {
    console.log("GitHub'a yükleniyor...");
    execSync('git add banned_ips.json', { stdio: 'inherit' });
    execSync('git commit -m "Ban listesi temizlendi - Tum IP\'ler kaldirildi"', { stdio: 'inherit' });
    execSync('git push', { stdio: 'inherit' });
    console.log('✅ İşlem tamamlandı');
  } catch (error) {
    console.error('❌ Git hatası:', error.message);
    console.log('Manuel: git add banned_ips.json && git commit -m "..." && git push');
  }
}

function clearAndPush() {
  console.log('Ban temizleme (banned_ips.json)');
  console.log('========================');
  if (clearBanList()) {
    pushToGitHub();
  }
}

function showHelp() {
  console.log(`
Ban temizleme

  node clear-bans.js

  banned_ips.json dosyasini {} yapar (calisan sunucu dosyayi izler ve birakilir).

NOT: Tum banlari kaldirir.
  `);
}

const args = process.argv.slice(2);
if (args.length === 0) {
  clearAndPush();
} else if (args[0] === 'help' || args[0] === '--help' || args[0] === '-h') {
  showHelp();
} else {
  console.log('Parametre yok; sadece: node clear-bans.js');
}
