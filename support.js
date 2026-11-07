/*
 * European SME — standalone runtime for the .dc.html design pages.
 * Lets each page render in any browser (e.g. on GitHub Pages) without the
 * Claude Design canvas: parses the <x-dc> template, runs the page's
 * Component class, and supports {{holes}}, <sc-for>, <sc-if>, <dc-import>,
 * event handlers (onClick / onInput / onChange) and setState re-renders.
 */
(function () {
  'use strict';

  // Hide the raw template while we build the real page.
  document.write('<style>x-dc{display:none!important}</style>');

  var VOID = { area: 1, base: 1, br: 1, col: 1, embed: 1, hr: 1, img: 1, input: 1, link: 1, meta: 1, source: 1, track: 1, wbr: 1 };
  var RAW = { style: 1, script: 1 };
  var SVG_NS = 'http://www.w3.org/2000/svg';

  function DCLogic(props) { this.props = props || {}; this.state = {}; }
  DCLogic.prototype.setState = function (patch) {
    var p = typeof patch === 'function' ? patch(this.state, this.props) : patch;
    this.state = Object.assign({}, this.state, p);
    if (this._rerender) this._rerender();
  };
  DCLogic.prototype.forceUpdate = function () { if (this._rerender) this._rerender(); };
  DCLogic.prototype.renderVals = function () { return {}; };
  window.DCLogic = DCLogic;

  var decoder = document.createElement('textarea');
  function decode(s) {
    if (s.indexOf('&') === -1) return s;
    decoder.innerHTML = s;
    return decoder.value;
  }

  // ---------- tiny HTML parser (for well-formed design markup) ----------
  function parseAttrs(src) {
    var attrs = [];
    var re = /([^\s=\/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g, m;
    while ((m = re.exec(src))) {
      var v = m[2] !== undefined ? m[2] : m[3] !== undefined ? m[3] : m[4] !== undefined ? m[4] : '';
      attrs.push([m[1], decode(v)]);
    }
    return attrs;
  }

  function parse(html) {
    var root = { tag: '#root', attrs: [], children: [] };
    var stack = [root];
    var re = /<!--[\s\S]*?-->|<\/([a-zA-Z][\w:-]*)\s*>|<([a-zA-Z][\w:-]*)((?:\s+[^\s=>\/]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*(\/?)>/g;
    var last = 0, m;
    function text(t) { if (t) stack[stack.length - 1].children.push({ text: decode(t) }); }
    while ((m = re.exec(html))) {
      text(html.slice(last, m.index));
      last = re.lastIndex;
      if (m[0].charAt(1) === '!') continue;
      if (m[1]) {
        var close = m[1];
        for (var i = stack.length - 1; i > 0; i--) {
          if (stack[i].tag === close) { stack.length = i; break; }
        }
        continue;
      }
      var node = { tag: m[2], attrs: parseAttrs(m[3] || ''), children: [] };
      stack[stack.length - 1].children.push(node);
      var lower = m[2].toLowerCase();
      if (RAW[lower]) {
        var end = html.indexOf('</' + m[2], last);
        if (end === -1) end = html.length;
        node.raw = html.slice(last, end);
        var gt = html.indexOf('>', end);
        last = re.lastIndex = gt === -1 ? html.length : gt + 1;
        continue;
      }
      if (!m[4] && !VOID[lower]) stack.push(node);
    }
    text(html.slice(last));
    return root.children;
  }

  // ---------- value lookup ----------
  var WHOLE = /^\s*\{\{\s*([^}]+?)\s*\}\}\s*$/;
  function lookup(expr, scope) {
    expr = expr.trim();
    if (expr === 'true') return true;
    if (expr === 'false') return false;
    if (expr === 'null') return null;
    if (/^-?\d+(\.\d+)?$/.test(expr)) return parseFloat(expr);
    if (/^(['"]).*\1$/.test(expr)) return expr.slice(1, -1);
    var parts = expr.split('.'), v = scope;
    for (var i = 0; i < parts.length; i++) {
      if (v == null) return undefined;
      v = v[parts[i]];
    }
    return v;
  }
  function interp(str, scope) {
    return str.replace(/\{\{\s*([^}]+?)\s*\}\}/g, function (_, e) {
      var v = lookup(e, scope);
      return v == null ? '' : String(v);
    });
  }
  function attrValue(raw, scope) {
    var w = WHOLE.exec(raw);
    return w ? lookup(w[1], scope) : interp(raw, scope);
  }

  // ---------- components ----------
  var defs = {};

  function extract(source) {
    var start = source.indexOf('<x-dc>'), end = source.lastIndexOf('</x-dc>');
    var inner = source.slice(start + 6, end);
    var helmet = '';
    var hm = /<helmet>([\s\S]*?)<\/helmet>/.exec(inner);
    if (hm) { helmet = hm[1]; inner = inner.replace(hm[0], ''); }
    var sm = /<script type="text\/x-dc"[^>]*>([\s\S]*?)<\/script>/.exec(source);
    var code = sm ? sm[1] : 'class Component extends DCLogic {}';
    /* eslint-disable no-new-func */
    var Cls = new Function('DCLogic', code + '\n;return Component;')(DCLogic);
    return { helmet: helmet, nodes: parse(inner), Cls: Cls, source: inner };
  }

  function importsIn(text) {
    var names = [], re = /<dc-import\s+name="([\w-]+)"/g, m;
    while ((m = re.exec(text))) if (names.indexOf(m[1]) === -1) names.push(m[1]);
    return names;
  }

  function loadDef(name) {
    if (defs[name]) return defs[name];
    defs[name] = fetch(name + '.dc.html')
      .then(function (r) { return r.text(); })
      .then(function (src) {
        var def = extract(src);
        defs[name] = def;
        // Child component styles (hover states etc.) go into the page once.
        if (def.helmet && /<style/i.test(def.helmet)) {
          var styles = def.helmet.match(/<style[\s\S]*?<\/style>/gi) || [];
          document.head.insertAdjacentHTML('beforeend', styles.join(''));
        }
        return Promise.all(importsIn(def.source).map(loadDef)).then(function () { return def; });
      });
    return defs[name];
  }

  function camel(s) { return s.replace(/-([a-z])/g, function (_, c) { return c.toUpperCase(); }); }

  // ---------- rendering ----------
  function renderNodes(nodes, scope, parent, svg) {
    for (var i = 0; i < nodes.length; i++) renderNode(nodes[i], scope, parent, svg);
  }

  function renderNode(n, scope, parent, svg) {
    if (n.text !== undefined) {
      parent.appendChild(document.createTextNode(interp(n.text, scope)));
      return;
    }
    var tag = n.tag, lower = tag.toLowerCase(), a = {}, k;
    for (k = 0; k < n.attrs.length; k++) a[n.attrs[k][0]] = n.attrs[k][1];

    if (lower === 'sc-for') {
      var list = attrValue(a.list || '', scope) || [];
      var as = a.as || 'item';
      for (var j = 0; j < list.length; j++) {
        var s2 = Object.create(scope);
        s2[as] = list[j];
        s2.$index = j;
        renderNodes(n.children, s2, parent, svg);
      }
      return;
    }
    if (lower === 'sc-if') {
      if (attrValue(a.value || '', scope)) renderNodes(n.children, scope, parent, svg);
      return;
    }
    if (lower === 'dc-import') {
      var def = defs[a.name];
      if (!def || !def.nodes) return;
      var props = {};
      for (k in a) {
        if (k === 'name' || k.indexOf('hint-') === 0) continue;
        props[camel(k)] = attrValue(a[k], scope);
      }
      var inst = new def.Cls(props);
      var host = document.createElement('div');
      host.style.display = 'contents';
      renderNodes(def.nodes, inst.renderVals() || {}, host, false);
      parent.appendChild(host);
      return;
    }
    if (lower === 'helmet') return;

    var isSvg = svg || lower === 'svg';
    var el = isSvg ? document.createElementNS(SVG_NS, tag) : document.createElement(tag);
    var deferredValue, deferredHtml;
    for (k = 0; k < n.attrs.length; k++) {
      var name = n.attrs[k][0], raw = n.attrs[k][1];
      if (/^on[A-Z]/.test(name)) {
        var fn = attrValue(raw, scope);
        if (typeof fn === 'function') {
          var type = name.slice(2).toLowerCase();
          el.addEventListener(type, fn);
          (el.__dcH || (el.__dcH = {}))[type] = fn;
        }
        continue;
      }
      var val = attrValue(raw, scope);
      if (name === 'dc-html') {
        deferredHtml = val == null ? '' : String(val);
        continue;
      }
      if (name === 'value' && (lower === 'input' || lower === 'select' || lower === 'textarea')) {
        deferredValue = val == null ? '' : String(val);
        if (lower === 'input') el.setAttribute('value', deferredValue);
        continue;
      }
      if (val === false || val == null) continue;
      el.setAttribute(name, val === true ? '' : String(val));
    }
    if (n.raw !== undefined) el.textContent = n.raw;
    else if (deferredHtml !== undefined) el.innerHTML = deferredHtml;
    else renderNodes(n.children, scope, el, isSvg && lower !== 'foreignobject');
    if (deferredValue !== undefined) { el.value = deferredValue; el.__dcV = deferredValue; }
    parent.appendChild(el);
  }

  // ---------- in-place DOM update ----------
  function sameKind(a, b) {
    if (a.nodeType !== b.nodeType) return false;
    if (a.nodeType !== 1) return true;
    return a.tagName === b.tagName && a.namespaceURI === b.namespaceURI &&
      (a.getAttribute('id') || '') === (b.getAttribute('id') || '');
  }

  function syncElement(o, n) {
    var i, attr;
    for (i = o.attributes.length - 1; i >= 0; i--) {
      attr = o.attributes[i].name;
      if (!n.hasAttribute(attr)) o.removeAttribute(attr);
    }
    for (i = 0; i < n.attributes.length; i++) {
      attr = n.attributes[i];
      if (o.getAttribute(attr.name) !== attr.value) o.setAttribute(attr.name, attr.value);
    }
    var oh = o.__dcH || {}, nh = n.__dcH || {}, t;
    for (t in oh) o.removeEventListener(t, oh[t]);
    for (t in nh) o.addEventListener(t, nh[t]);
    o.__dcH = n.__dcH;
    morph(o, n);
    if (n.__dcV !== undefined) {
      o.__dcV = n.__dcV;
      if (o.value !== n.__dcV && document.activeElement !== o) o.value = n.__dcV;
      if (o.tagName === 'SELECT' && o.value !== n.__dcV) o.value = n.__dcV;
    }
  }

  function morph(oldParent, newParent) {
    var incoming = Array.prototype.slice.call(newParent.childNodes);
    for (var i = 0; i < incoming.length; i++) {
      var nn = incoming[i], on = oldParent.childNodes[i];
      if (!on) { oldParent.appendChild(nn); continue; }
      if (!sameKind(on, nn)) { oldParent.replaceChild(nn, on); continue; }
      if (on.nodeType === 1) syncElement(on, nn);
      else if (on.nodeValue !== nn.nodeValue) on.nodeValue = nn.nodeValue;
    }
    while (oldParent.childNodes.length > incoming.length) oldParent.removeChild(oldParent.lastChild);
  }

  function mount() {
    var source = document.documentElement.outerHTML;
    fetch(location.pathname, { cache: 'no-cache' })
      .then(function (r) { return r.ok ? r.text() : source; })
      .catch(function () { return source; })
      .then(function (src) {
        var def = extract(src);
        if (def.helmet) document.head.insertAdjacentHTML('beforeend', def.helmet);
        return Promise.all(importsIn(def.source).map(loadDef)).then(function () { return def; });
      })
      .then(function (def) {
        var root = document.createElement('div');
        root.id = 'dc-root';
        document.body.insertBefore(root, document.body.firstChild);
        var inst = new def.Cls({});
        var draw = function () {
          // Build the new tree off-screen, then update the live page in
          // place, so fields being typed in keep their caret and focus.
          var next = document.createElement('div');
          renderNodes(def.nodes, inst.renderVals() || {}, next, false);
          morph(root, next);
        };
        inst._rerender = draw;
        if (inst.componentWillMount) inst.componentWillMount();
        draw();
        if (inst.componentDidMount) inst.componentDidMount();
        if (location.hash) {
          var target = document.getElementById(location.hash.slice(1));
          if (target) target.scrollIntoView();
        }
      })
      .catch(function (err) {
        document.body.insertAdjacentHTML('afterbegin', '<p style="font:16px sans-serif;padding:24px">This page could not be loaded. (' + String(err) + ')</p>');
      });
  }

  // ---------- live articles from europeansme.eu ----------
  var API = 'https://europeansme.eu/wp-json/wp/v2/posts?per_page=100&_embed=wp:featuredmedia,wp:term,author';
  var SECTIONS = {
    funding: { label: 'Funding & Grants', color: '#B07A00' },
    growth: { label: 'Growth & Strategy', color: '#2F5BB7' },
    money: { label: 'Money & Cash Flow', color: '#0F7B6C' },
    marketing: { label: 'Marketing & Brand', color: '#8A3FB8' },
    people: { label: 'People & Leadership', color: '#C2410C' },
    tech: { label: 'Tech & AI', color: '#4338CA' },
    policy: { label: 'EU Policy', color: '#0B2A6B' }
  };
  var CAT_MAP = {
    funding: 'funding', 'eu-grant': 'funding', investment: 'funding', finance: 'funding',
    'business-growth': 'growth', 'business-planning': 'growth', 'export': 'growth', franchise: 'growth', advisory: 'growth',
    economic: 'growth', pricing: 'growth', sales: 'growth', supply: 'growth', sustainability: 'growth',
    'cash-flow': 'money', payments: 'money', 'electronic-invoicing': 'money', tax: 'money', insurance: 'money',
    marketing: 'marketing', brand: 'marketing', 'e-commerce': 'marketing',
    hiring: 'people', leadership: 'people', remote: 'people', 'eu-time-zones': 'people', 'eu-employment-law': 'people',
    'digital-transformation': 'tech', cybersecurity: 'tech', 'artificial-intelligence': 'tech',
    law: 'policy'
  };
  var POLICY_RE = /\bVAT\b|\bTax|GDPR|\bLaw\b|\bAct\b|State Aid|Competition|Procurement|Compliance|Regulat/i;
  function plain(html) { return decode(String(html || '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim(); }
  function clean(html) {
    return String(html || '')
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*')/gi, '');
  }
  function mapPost(p) {
    var emb = p._embedded || {};
    var media = (emb['wp:featuredmedia'] || [])[0] || {};
    var sizes = (media.media_details && media.media_details.sizes) || {};
    var pickSize = function (names) {
      for (var i = 0; i < names.length; i++) if (sizes[names[i]]) return sizes[names[i]].source_url;
      return media.source_url || '';
    };
    var cats = ((emb['wp:term'] || [])[0] || []);
    var catSlug = cats.length ? cats[0].slug : '';
    var title = plain(p.title && p.title.rendered);
    var section = CAT_MAP[catSlug] || (POLICY_RE.test(title) ? 'policy' : 'growth');
    var text = plain(p.content && p.content.rendered);
    var words = (text.match(/\S+/g) || []).length;
    var excerpt = plain(p.excerpt && p.excerpt.rendered).replace(/\s*\[…\]\s*$|\s*\[&hellip;\]\s*$/, '');
    if (excerpt.length > 220) excerpt = excerpt.slice(0, 217).replace(/\s+\S*$/, '') + '…';
    var d = new Date(p.date);
    return {
      id: p.id, slug: p.slug, link: p.link, title: title, excerpt: excerpt,
      date: d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }),
      shortDate: d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }),
      mins: Math.max(1, Math.round(words / 220)),
      img: pickSize(['medium_large', 'large', 'bunyad-768', 'full']),
      imgLarge: pickSize(['full', 'large', 'medium_large']),
      thumb: pickSize(['bunyad-small', 'medium', 'thumbnail', 'medium_large']),
      alt: media.alt_text || title,
      section: section, sectionLabel: SECTIONS[section].label, color: SECTIONS[section].color,
      category: cats.length ? plain(cats[0].name) : '',
      author: ((emb.author || [])[0] || {}).name || 'European SME',
      href: 'Post.dc.html?slug=' + encodeURIComponent(p.slug),
      content: clean(p.content && p.content.rendered)
    };
  }
  var postsPromise = null;
  window.ESME = {
    sections: SECTIONS,
    loadPosts: function () {
      if (postsPromise) return postsPromise;
      var KEY = 'esme-posts-v2';
      try {
        var cached = JSON.parse(sessionStorage.getItem(KEY) || 'null');
        if (cached && cached.at > Date.now() - 15 * 60 * 1000) { postsPromise = Promise.resolve(cached.posts); return postsPromise; }
      } catch (e) { /* storage unavailable */ }
      postsPromise = fetch(API).then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      }).then(function (list) {
        var posts = list.map(mapPost);
        try { sessionStorage.setItem(KEY, JSON.stringify({ at: Date.now(), posts: posts })); } catch (e) { /* too large or blocked */ }
        return posts;
      });
      postsPromise.catch(function () { postsPromise = null; });
      return postsPromise;
    },
    // Take up to n posts matching test, never reusing one already in `used`.
    take: function (posts, test, n, used) {
      var out = [];
      for (var i = 0; i < posts.length && out.length < n; i++) {
        var p = posts[i];
        if (used[p.id] || (test && !test(p))) continue;
        used[p.id] = true;
        out.push(p);
      }
      return out;
    },
    param: function (name) { return new URLSearchParams(location.search).get(name); }
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
  else mount();
})();
