/* Real Life Notes — 浏览器端加解密（Web Crypto）
 *
 * 前后台共用：后台用密码加密登录 Token，私密文章用「解锁密码派生的内容密钥」整篇加密。
 * 仅安全上下文（HTTPS / localhost）可用；密码只在内存，绝不落盘。
 *
 * 两种 payload：
 *   - 自带 KDF 参数（密码加密 Token）：{v,kdf,iter,algo,salt,iv,ct}
 *   - 仅 iv/ct（内容密钥加密文章） ：{v,algo,iv,ct}
 * 对应密码学约定见 docs/data-model.md §4。
 */
(function (global) {
  'use strict';

  var DEFAULT_ITER = 120000;
  var VERIFY_TEXT = 'rln-private-v1';
  var ERR_BAD = '密码不正确或数据损坏';

  function supported() {
    return !!(global.crypto && global.crypto.subtle && global.crypto.getRandomValues &&
      global.TextEncoder && global.TextDecoder && global.btoa && global.atob);
  }

  function assertSupported() {
    if (!supported()) throw new Error('当前环境不支持加密（需 HTTPS）');
  }

  function b64(bytes) {
    var bin = '';
    for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return global.btoa(bin);
  }

  function unb64(str) {
    var bin = global.atob(str);
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  }

  function rand(n) {
    return global.crypto.getRandomValues(new Uint8Array(n));
  }

  function utf8(str) {
    return new TextEncoder().encode(str);
  }

  function importPassword(password) {
    return global.crypto.subtle.importKey('raw', utf8(password), 'PBKDF2', false, ['deriveKey']);
  }

  function deriveFromSalt(password, saltBytes, iter, usages) {
    return importPassword(password).then(function (base) {
      return global.crypto.subtle.deriveKey(
        { name: 'PBKDF2', salt: saltBytes, iterations: iter || DEFAULT_ITER, hash: 'SHA-256' },
        base,
        { name: 'AES-GCM', length: 256 },
        false,
        usages || ['encrypt', 'decrypt']
      );
    });
  }

  /* 密码 + 已有 salt 派生内容密钥（salt 来自 private-key.json） */
  function deriveKey(password, saltB64, iter) {
    assertSupported();
    return deriveFromSalt(password, unb64(saltB64), iter, ['encrypt', 'decrypt']);
  }

  function seal(text, key) {
    var iv = rand(12);
    return global.crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv }, key, utf8(text))
      .then(function (ct) {
        return { v: 1, algo: 'AES-256-GCM', iv: b64(iv), ct: b64(new Uint8Array(ct)) };
      });
  }

  function open(payload, key) {
    var p = normalize(payload);
    return global.crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: unb64(p.iv) }, key, unb64(p.ct)
    ).then(function (buf) {
      return new TextDecoder().decode(buf);
    }).catch(function () {
      throw new Error(ERR_BAD);
    });
  }

  function normalize(payload) {
    var p = payload;
    if (typeof p === 'string') {
      try { p = JSON.parse(p); } catch (e) { throw new Error(ERR_BAD); }
    }
    if (!p || typeof p !== 'object' || !p.iv || !p.ct) throw new Error(ERR_BAD);
    return p;
  }

  /* ---- 密码直接加密（Token）---- */

  function encryptWithPassword(text, password) {
    assertSupported();
    var saltBytes = rand(16);
    var iv = rand(12);
    return deriveFromSalt(password, saltBytes, DEFAULT_ITER, ['encrypt']).then(function (key) {
      return global.crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv }, key, utf8(text));
    }).then(function (ct) {
      return JSON.stringify({
        v: 1, kdf: 'PBKDF2-SHA256', iter: DEFAULT_ITER, algo: 'AES-256-GCM',
        salt: b64(saltBytes), iv: b64(iv), ct: b64(new Uint8Array(ct))
      });
    });
  }

  function decryptWithPassword(payload, password) {
    assertSupported();
    var p;
    try { p = typeof payload === 'string' ? JSON.parse(payload) : payload; }
    catch (e) { throw new Error(ERR_BAD); }
    if (!p || p.v !== 1 || !p.salt || !p.iv || !p.ct) throw new Error(ERR_BAD);
    return deriveFromSalt(password, unb64(p.salt), p.iter || DEFAULT_ITER, ['decrypt'])
      .then(function (key) {
        return global.crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(p.iv) }, key, unb64(p.ct));
      })
      .then(function (buf) { return new TextDecoder().decode(buf); })
      .catch(function () { throw new Error(ERR_BAD); });
  }

  /* ---- 内容密钥（私密文章）---- */

  function encryptText(text, key) {
    assertSupported();
    return seal(text, key);
  }

  function decryptText(payload, key) {
    assertSupported();
    return open(payload, key);
  }

  function encryptJson(obj, key) {
    return encryptText(JSON.stringify(obj), key);
  }

  function decryptJson(payload, key) {
    return decryptText(payload, key).then(function (text) {
      try { return JSON.parse(text); } catch (e) { throw new Error(ERR_BAD); }
    });
  }

  /* 创建私密文章密钥文件（含 verifier，用于快速判断密码是否正确） */
  function createKeyFile(password) {
    assertSupported();
    var saltBytes = rand(16);
    return deriveFromSalt(password, saltBytes, DEFAULT_ITER, ['encrypt', 'decrypt']).then(function (key) {
      return seal(VERIFY_TEXT, key).then(function (v) {
        return {
          key: key,
          file: {
            v: 1, kdf: 'PBKDF2-SHA256', iter: DEFAULT_ITER,
            salt: b64(saltBytes), verifierIv: v.iv, verifier: v.ct
          }
        };
      });
    });
  }

  /* 用密码解锁已有密钥文件；密码错误统一抛 ERR_BAD */
  function unlockKey(file, password) {
    assertSupported();
    var p = file;
    if (typeof p === 'string') {
      try { p = JSON.parse(p); } catch (e) { throw new Error(ERR_BAD); }
    }
    if (!p || !p.salt || !p.verifier || !p.verifierIv) throw new Error(ERR_BAD);
    return deriveFromSalt(password, unb64(p.salt), p.iter || DEFAULT_ITER, ['encrypt', 'decrypt'])
      .then(function (key) {
        return global.crypto.subtle.decrypt(
          { name: 'AES-GCM', iv: unb64(p.verifierIv) }, key, unb64(p.verifier)
        ).then(function (buf) {
          if (new TextDecoder().decode(buf) !== VERIFY_TEXT) throw new Error(ERR_BAD);
          return key;
        });
      })
      .catch(function () { throw new Error(ERR_BAD); });
  }

  /* ---- rln-enc 围栏 ---- */

  function fence(payload) {
    var json = typeof payload === 'string' ? payload : JSON.stringify(payload);
    return '```rln-enc\n' + json + '\n```\n';
  }

  function unfence(body) {
    var m = String(body == null ? '' : body).match(/^\s*```rln-enc[ \t]*\r?\n([\s\S]*?)\r?\n```\s*$/);
    if (!m) return null;
    try { return JSON.parse(m[1].trim()); } catch (e) { return null; }
  }

  function isFenced(body) {
    return /^\s*```rln-enc\b/.test(String(body == null ? '' : body));
  }

  global.rlnCrypto = {
    DEFAULT_ITER: DEFAULT_ITER,
    VERIFY_TEXT: VERIFY_TEXT,
    isSupported: supported,
    b64: b64,
    unb64: unb64,
    deriveKey: deriveKey,
    encryptText: encryptText,
    decryptText: decryptText,
    encryptJson: encryptJson,
    decryptJson: decryptJson,
    encryptWithPassword: encryptWithPassword,
    decryptWithPassword: decryptWithPassword,
    createKeyFile: createKeyFile,
    unlockKey: unlockKey,
    fence: fence,
    unfence: unfence,
    isFenced: isFenced
  };
})(typeof window !== 'undefined' ? window : this);
