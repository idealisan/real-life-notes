(function (global) {
  'use strict';

  /* 加密模块：AES-256-GCM + PBKDF2-SHA256（12 万次派生），Web Crypto 实现。
     密文结构（JSON 字符串）：{ v, kdf, iter, algo, salt, iv, ct }（salt/iv/ct 为 base64）。
     仅在安全上下文（HTTPS / localhost）可用（crypto.subtle 限制）。 */

  function b64enc(bytes) {
    var bin = '';
    for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin);
  }
  function b64dec(str) {
    var bin = atob(str);
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  }

  function supported() {
    return !!(global.crypto && global.crypto.subtle && global.TextEncoder && global.btoa);
  }

  function encrypt(text, password) {
    var enc = new TextEncoder();
    var salt = crypto.getRandomValues(new Uint8Array(16));
    var iv = crypto.getRandomValues(new Uint8Array(12));
    return crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey'])
      .then(function (base) {
        return crypto.subtle.deriveKey(
          { name: 'PBKDF2', salt: salt, iterations: 120000, hash: 'SHA-256' },
          base,
          { name: 'AES-GCM', length: 256 },
          false,
          ['encrypt']
        );
      })
      .then(function (key) {
        return crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv }, key, enc.encode(text));
      })
      .then(function (ct) {
        return JSON.stringify({
          v: 1, kdf: 'PBKDF2-SHA256', iter: 120000, algo: 'AES-256-GCM',
          salt: b64enc(salt), iv: b64enc(iv), ct: b64enc(new Uint8Array(ct))
        });
      });
  }

  function decrypt(payload, password) {
    var p;
    try { p = JSON.parse(payload); } catch (e) { return Promise.reject(new Error('加密数据损坏')); }
    if (!p || p.v !== 1 || !p.salt || !p.iv || !p.ct) {
      return Promise.reject(new Error('不支持的加密数据'));
    }
    return crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey'])
      .then(function (base) {
        return crypto.subtle.deriveKey(
          { name: 'PBKDF2', salt: b64dec(p.salt), iterations: p.iter || 120000, hash: 'SHA-256' },
          base,
          { name: 'AES-GCM', length: 256 },
          false,
          ['decrypt']
        );
      })
      .then(function (key) {
        return crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64dec(p.iv) }, key, b64dec(p.ct));
      })
      .then(function (pt) { return new TextDecoder().decode(pt); })
      .catch(function (err) {
        if (err && err.message && (err.message === '加密数据损坏' || err.message === '不支持的加密数据')) throw err;
        throw new Error('密码错误或数据损坏');
      });
  }

  global.enc = { supported: supported, encrypt: encrypt, decrypt: decrypt };
})(window);
