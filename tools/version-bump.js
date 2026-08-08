#!/usr/bin/env node
/* 版本化构建：把会被 CDN 缓存的代码资源（js / css）统一复制到
   assets/v<时间戳>/ 目录，并让所有 HTML 引用该目录下的资源。

   目的：CDN（如 Cloudflare）会按 URL 缓存资源；当代码变更时，只要目录名
   （即时间戳）变化，新 URL 就是缓存 MISS，浏览器立即拿到新代码，
   不再需要手工递增 ?v= 版本号。

   规则：
   - 目录名 = 各代码资源源文件 mtime 的最大值（unix 秒），同一批改动共用一个版本目录。
   - 进入版本目录的只有"代码"（js / css）。用户内容（图片、markdown）以及每次发布
     都会重写的用户数据（config.json、content/index.json）不进入版本目录，引用固定路径。
   - 旧版本目录在换版本时删除，仓库只保留当前版本（旧 CDN 缓存按 TTL 自然过期）。
   - 幂等且防同秒改动：除时间戳外还会比对版本目录内文件内容与源文件；两者都一致才跳过。
   - 变更代码后：node tools/version-bump.js && git add -A && git commit && git push
     （保证 HTML 与版本目录在同一个提交里上线，避免引用不存在的目录）

   用法：node tools/version-bump.js         （实际执行）
         node tools/version-bump.js --dry-run（只打印将要发生的事）
*/
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const OUT_PREFIX = 'assets/v';                       // 版本目录前缀 assets/v<ts>

// 需要版本化的代码资源（相对仓库根）。纯静态代码；如需版本化某个静态 json 代码配置，加入即可。
const SOURCES = [
  'assets/js/theme.js',
  'assets/js/md.js',
  'assets/js/site.js',
  'assets/js/gh.js',
  'assets/css/base.css',
  'assets/css/site.css',
  'admin/admin.js',
  'admin/admin.css'
];

const BASENAMES = SOURCES.map((s) => path.basename(s));
const HTML_FILES = ['index.html', 'post.html', '404.html', 'admin/index.html', 'admin/login.html'];

function readFile(rel) {
  return fs.readFileSync(path.join(ROOT, rel));
}

function computeTs() {
  return SOURCES.reduce((max, rel) => {
    const st = fs.statSync(path.join(ROOT, rel));
    return Math.max(max, Math.floor(st.mtimeMs / 1000));
  }, 0);
}

function fingerprint() {
  const h = crypto.createHash('sha1');
  SOURCES.forEach((rel) => h.update(readFile(rel)));
  return h.digest('hex').slice(0, 16);
}

function existingVersionDirs() {
  const list = fs.readdirSync(path.join(ROOT, 'assets'));
  return list.filter((n) => /^v\d+$/.test(n)).sort();
}

function upToDate(ts, fp) {
  const dir = path.join(ROOT, OUT_PREFIX + ts);
  if (!fs.existsSync(dir)) return false;
  for (const rel of SOURCES) {
    const copy = path.join(dir, path.basename(rel));
    if (!fs.existsSync(copy)) return false;
    if (!readFile(rel).equals(fs.readFileSync(copy))) return false;
  }
  return true;
}

function rewriteHtml(ts) {
  HTML_FILES.forEach((file) => {
    const prefix = (file.indexOf('admin/') === 0 ? '../' : '') + OUT_PREFIX + ts;
    const full = path.join(ROOT, file);
    let src = fs.readFileSync(full, 'utf8');
    BASENAMES.forEach((base) => {
      const re = new RegExp('((?:src|href)=")(?:[^"]*/)?' + base + '(?:\\?[^"]*)?(")', 'g');
      src = src.replace(re, '$1' + prefix + '/' + base + '$2');
    });
    fs.writeFileSync(full, src);
  });
}

const dry = process.argv.indexOf('--dry-run') !== -1;
const ts = computeTs();
const fp = fingerprint();
const dirBase = OUT_PREFIX.split('/').pop() + ts;      // v<ts>（与 existingVersionDirs 一致）
const dir = 'assets/' + dirBase;
const old = existingVersionDirs();
const fresh = upToDate(ts, fp);

console.log('timestamp      :', ts);
console.log('fingerprint    :', fp);
console.log('version dir    :', dir);
console.log('old dirs       :', JSON.stringify(old));
console.log('up to date     :', fresh ? 'yes' : 'no');

if (dry) process.exit(0);

let pruned = 0;
old.filter((d) => d !== dirBase).forEach((d) => {
  fs.rmSync(path.join(ROOT, 'assets', d), { recursive: true, force: true });
  pruned++;
});
if (pruned) console.log('已清理旧版本目录:', pruned);

if (fresh) process.exit(0);

const outDir = path.join(ROOT, dir);
fs.mkdirSync(outDir, { recursive: true });
SOURCES.forEach((rel) => {
  fs.copyFileSync(path.join(ROOT, rel), path.join(outDir, path.basename(rel)));
});
rewriteHtml(ts);
console.log('done: 已生成 ' + dir + ' 并重写 ' + HTML_FILES.join(', '));
