(function (global) {
  'use strict';

  var FRONTMETA_KEYS = ['title', 'tags', 'date', 'updated', 'draft', 'pinned'];

  function md() {}

  if (global.marked) {
    global.marked.setOptions({ gfm: true, breaks: true });
  }

  md.parseFrontmatter = function (text) {
    var meta = { title: '', tags: [], date: '', updated: '', draft: false };
    var body = String(text == null ? '' : text).replace(/^\uFEFF/, '');
    if (body.slice(0, 3) === '---') {
      var end = body.indexOf('\n---', 3);
      if (end !== -1) {
        var head = body.slice(3, end);
        body = body.slice(end + 4).replace(/^\n/, '');
        head.split('\n').forEach(function (line) {
          var idx = line.indexOf(':');
          if (idx === -1) return;
          var key = line.slice(0, idx).trim();
          var val = line.slice(idx + 1).trim();
          if (key === 'title') meta.title = val;
          else if (key === 'tags') meta.tags = val.replace(/^\[|\]$/g, '').split(',').map(function (t) { return t.trim(); }).filter(Boolean);
          else if (key === 'date') meta.date = val;
          else if (key === 'updated') meta.updated = val;
          else if (key === 'draft') meta.draft = val === 'true';
          else if (key === 'pinned') meta.pinned = val === 'true';
        });
      }
    }
    return { meta: meta, body: body };
  };

  md.buildFrontmatter = function (meta) {
    meta = meta || {};
    var lines = ['---'];
    lines.push('title: ' + (meta.title || '').trim());
    if (Array.isArray(meta.tags) && meta.tags.length) {
      lines.push('tags: [' + meta.tags.join(', ') + ']');
    }
    lines.push('date: ' + (meta.date || new Date().toISOString()));
    if (meta.updated) lines.push('updated: ' + meta.updated);
    if (meta.draft) lines.push('draft: true');
    if (meta.pinned) lines.push('pinned: true');
    lines.push('---', '');
    return lines.join('\n');
  };

  md.render = function (markdown) {
    var mdText = String(markdown == null ? '' : markdown);
    var math = renderMath(mdText);
    var html = global.marked ? global.marked.parse(math.text) : math.text;
    if (global.DOMPurify) {
      html = global.DOMPurify.sanitize(html, {
        FORBID_ATTR: ['style'],
        USE_PROFILES: { html: true }
      });
    }
    if (global.hljs && global.document && global.document.createElement) {
      var tmp = global.document.createElement('div');
      tmp.innerHTML = html;
      tmp.querySelectorAll('pre code').forEach(function (el) {
        var m = (el.className || '').match(/language-([\w-]+)/);
        if (!m) return;
        try {
          if (global.hljs.getLanguage(m[1])) global.hljs.highlightElement(el);
        } catch (e) {}
      });
      html = tmp.innerHTML;
    }
    math.math.forEach(function (m, i) {
      html = html.split('@@MATH-' + i + '@@').join(m);
    });
    return html;
  };

  function renderMath(text) {
    var mathHtml = [];
    var codeBlocks = [];

    function pushMath(latex, display) {
      var html;
      if (global.katex) {
        try {
          html = global.katex.renderToString(latex, {
            throwOnError: false,
            displayMode: !!display,
            output: 'html'
          });
        } catch (e) {
          html = '<span class="math-err">' + md.esc(latex) + '</span>';
        }
      } else {
        html = md.esc(latex);
      }
      var idx = mathHtml.length;
      mathHtml.push(html);
      return '@@MATH-' + idx + '@@';
    }

    var out = text
      .replace(/```[\s\S]*?```|~~~[\s\S]*?~~~/g, function (m) {
        codeBlocks.push(m);
        return '@@CODE-' + (codeBlocks.length - 1) + '@@';
      })
      .replace(/`[^`\n]+`/g, function (m) {
        codeBlocks.push(m);
        return '@@CODE-' + (codeBlocks.length - 1) + '@@';
      });

    out = out.replace(/(?<!\\)\$\$([\s\S]+?)\$\$/g, function (m, latex) {
      return pushMath(latex.trim(), true);
    });

    out = out.replace(/(?<!\\)\$([^$\n]+?)\$/g, function (m, latex) {
      var t = latex.trim();
      if (!t.length) return m;
      if (/^\d/.test(t) || /\s$/.test(latex) || /^\s/.test(latex)) return m;
      return pushMath(t, false);
    });

    out = out.replace(/@@CODE-(\d+)@@/g, function (m, i) {
      return codeBlocks[+i];
    });

    return { text: out, math: mathHtml };
  }

  md.stripFrontmatter = function (text) {
    var parsed = md.parseFrontmatter(text);
    return parsed.body;
  };

  md.excerpt = function (text, max) {
    max = max || 160;
    var body = md.stripFrontmatter(text);
    body = body
      .replace(/```[\s\S]*?```/g, ' ')
      .replace(/\$\$[\s\S]*?\$\$/g, ' ')
      .replace(/\$[^$\n]*\$/g, ' ')
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/[#>*~`|]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (body.length <= max) return body;
    var cut = body.slice(0, max);
    var sp = cut.lastIndexOf(' ');
    if (sp > max * 0.6) cut = cut.slice(0, sp);
    return cut.replace(/\s+$/, '') + '…';
  };

  md.esc = function (str) {
    return String(str == null ? '' : str).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };

  md.slugify = function (title) {
    var s = String(title == null ? '' : title).trim().toLowerCase()
      .replace(/[^\p{L}\p{N}]/gu, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');
    return s;
  };

  md.isoNow = function (d) {
    d = d || new Date();
    var tz = -d.getTimezoneOffset();
    var sign = tz >= 0 ? '+' : '-';
    var abs = Math.abs(tz);
    return d.getFullYear() + '-' +
      pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + 'T' +
      pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds()) +
      sign + pad(Math.floor(abs / 60)) + ':' + pad(abs % 60);
    function pad(n) { return (n < 10 ? '0' : '') + n; }
  };

  md.formatDate = function (iso) {
    if (!iso) return '';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' });
  };

  md.fullDate = function (iso) {
    if (!iso) return '';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  };

  global.md = md;
})(window);
