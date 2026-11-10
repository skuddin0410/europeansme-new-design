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

  var renderPass = { counts: {}, cache: {}, mounts: [], redraw: null };
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
      // Keep one instance per stateful component slot across redraws so it can
      // hold state and run componentDidMount once. Stateless ones (no
      // componentDidMount) are cheap to recreate.
      var inst, slot = a.name + '#' + (renderPass.counts[a.name] = (renderPass.counts[a.name] || 0) + 1);
      if (def.Cls.prototype.componentDidMount) {
        inst = renderPass.cache[slot];
        if (!inst) {
          inst = new def.Cls(props);
          inst._rerender = function () { if (renderPass.redraw) renderPass.redraw(); };
          renderPass.cache[slot] = inst;
          renderPass.mounts.push(inst);
        } else {
          inst.props = props;
        }
      } else {
        inst = new def.Cls(props);
      }
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
          renderPass.counts = {};
          renderNodes(def.nodes, inst.renderVals() || {}, next, false);
          morph(root, next);
          var mounts = renderPass.mounts.splice(0);
          mounts.forEach(function (c) { c.componentDidMount(); });
        };
        renderPass.redraw = draw;
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
    funding: { desc: 'Grants, loans and investors', label: 'Funding & Grants', color: '#B07A00' },
    growth: { desc: 'Strategy, exporting, scaling up', label: 'Growth & Strategy', color: '#2F5BB7' },
    money: { desc: 'Cash flow, payments, tax', label: 'Money & Cash Flow', color: '#0F7B6C' },
    marketing: { desc: 'Brand, digital, sales', label: 'Marketing & Brand', color: '#8A3FB8' },
    people: { desc: 'Hiring, teams, leadership', label: 'People & Leadership', color: '#C2410C' },
    tech: { desc: 'AI, cyber security, digital tools', label: 'Tech & AI', color: '#4338CA' },
    policy: { desc: 'EU rules and compliance', label: 'EU Policy', color: '#0B2A6B' }
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

  // Line icons (24px grid, stroke = currentColor), used by menus, tool cards and tool pages.
  var ICONS = {
    funding: '<ellipse cx="12" cy="6.5" rx="7" ry="3"/><path d="M5 6.5v5c0 1.66 3.13 3 7 3s7-1.34 7-3v-5"/><path d="M5 11.5v5c0 1.66 3.13 3 7 3s7-1.34 7-3v-5"/>',
    growth: '<rect x="4" y="13" width="4" height="7" rx="1"/><rect x="10" y="9" width="4" height="11" rx="1"/><rect x="16" y="4" width="4" height="16" rx="1"/><path d="M2.5 21h19"/>',
    money: '<path d="M3 8h16a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8z"/><path d="M3 8V6.5A2.5 2.5 0 0 1 5.5 4H16v4"/><path d="M16.5 12H21v4h-4.5a2 2 0 0 1 0-4z"/>',
    marketing: '<path d="M14 5v14l-6-4H5a2 2 0 0 1-2-2v-2a2 2 0 0 1 2-2h3l6-4z"/><path d="M18 9.5a3.5 3.5 0 0 1 0 5M8 15l1.5 5"/>',
    people: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M21.5 20a6.5 6.5 0 0 0-4-6"/>',
    tech: '<rect x="5" y="5" width="14" height="14" rx="2.5"/><rect x="9" y="9" width="6" height="6" rx="1"/><path d="M9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3"/>',
    policy: '<path d="M12 3l9 5H3l9-5z"/><path d="M5 10.5v7M9.5 10.5v7M14.5 10.5v7M19 10.5v7M3 21h18M4 18.5h16"/>',
    all: '<rect x="4" y="4" width="7" height="7" rx="2"/><rect x="13" y="4" width="7" height="7" rx="2"/><rect x="4" y="13" width="7" height="7" rx="2"/><rect x="13" y="13" width="7" height="7" rx="2"/>',
    news: '<path d="M4 5h13v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5z"/><path d="M17 9h3v10a2 2 0 0 1-2 2M7.5 9h6M7.5 12.5h6M7.5 16h4"/>',
    guide: '<path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5v-15z"/><path d="M4 20.5A2.5 2.5 0 0 0 6.5 23H20v-5M8 7.5h8M8 11h5"/>',
    trend: '<path d="M3 17l6-6 4 4 8-8"/><path d="M15 7h6v6"/>',
    pin: '<path d="M12 21s7-6.1 7-11.5A7 7 0 0 0 5 9.5C5 14.9 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>',
    calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4M8 14h2M14 14h2M8 17h2"/>',
    calculator: '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M8 7h8M8 11h.01M12 11h.01M16 11h.01M8 15h.01M12 15h.01M16 15v3M8 18h4"/>',
    check: '<circle cx="12" cy="12" r="9"/><path d="M8 12.5l2.8 2.8L16.5 9.5"/>',
    invoice: '<path d="M6 3h9l4 4v14H6z"/><path d="M14 3v5h5M9 12h7M9 16h5"/>',
    percent: '<path d="M19 5L5 19"/><circle cx="7" cy="7" r="2.5"/><circle cx="17" cy="17" r="2.5"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
    shield: '<path d="M12 3l8 3v6c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V6l8-3z"/><path d="M8.5 12l2.5 2.5 4.5-5"/>',
    hire: '<circle cx="10" cy="8" r="3.5"/><path d="M3.5 20a6.5 6.5 0 0 1 13 0M19 8v6M16 11h6"/>',
    ai: '<path d="M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8L12 3z"/><path d="M18 15l.9 2.1L21 18l-2.1.9L18 21l-.9-2.1L15 18l2.1-.9L18 15z"/>',
    leaf: '<path d="M5 19c0-8 5-13 15-14-1 10-6 15-14 15"/><path d="M5 19l7-7"/>',
    grid: '<rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/>',
    arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>'
  };
  // Soft fill layer drawn under the outline, giving the topic icons a two-tone look.
  var DUO = {
    funding: '<ellipse cx="12" cy="6.5" rx="7" ry="3"/><path d="M5 11.5c0 1.66 3.13 3 7 3s7-1.34 7-3v5c0 1.66-3.13 3-7 3s-7-1.34-7-3z"/>',
    growth: '<rect x="16" y="4" width="4" height="16" rx="1"/><rect x="10" y="9" width="4" height="11" rx="1"/>',
    money: '<path d="M3 8h16a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8z"/>',
    marketing: '<path d="M14 5v14l-6-4H5a2 2 0 0 1-2-2v-2a2 2 0 0 1 2-2h3l6-4z"/>',
    people: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0z"/>',
    tech: '<rect x="9" y="9" width="6" height="6" rx="1"/><rect x="5" y="5" width="14" height="14" rx="2.5" opacity=".45"/>',
    policy: '<path d="M12 3l9 5H3l9-5z"/><rect x="4" y="18.5" width="16" height="2.5"/>',
    all: '<rect x="4" y="4" width="7" height="7" rx="2"/><rect x="13" y="13" width="7" height="7" rx="2"/>',
    news: '<path d="M4 5h13v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5z"/>',
    guide: '<path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5v-15z"/>',
    pin: '<path d="M12 21s7-6.1 7-11.5A7 7 0 0 0 5 9.5C5 14.9 12 21 12 21z"/>',
    shield: '<path d="M12 3l8 3v6c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V6l8-3z"/>',
    globe: '<circle cx="12" cy="12" r="9"/>',
    calendar: '<rect x="3" y="5" width="18" height="5"/>',
    hire: '<circle cx="10" cy="8" r="3.5"/>'
  };
  function icon(name, size, width) {
    var duo = DUO[name] ? '<g fill="currentColor" fill-opacity=".22" stroke="none">' + DUO[name] + '</g>' : '';
    return '<svg aria-hidden="true" width="' + (size || 20) + '" height="' + (size || 20) + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="' + (width || 1.8) + '" stroke-linecap="round" stroke-linejoin="round" style="display:block">' + duo + (ICONS[name] || ICONS.grid) + '</svg>';
  }
  // Every tool on the site, in one list, so the header menu, homepage and Tools page stay in step.
  var TOOLS = [
    { key: 'funding', name: 'EU Funding Finder', short: 'Grants, loans and equity by country', icon: 'search', href: 'FundingFinder.dc.html', tone: '#0B2A6B' },
    { key: 'compliance', name: 'Compliance Calendar', short: 'Every EU deadline that applies to you', icon: 'calendar', href: 'Compliance.dc.html', tone: '#14181D' },
    { key: 'vat-route', name: 'Cross-border VAT route finder', short: 'Selling to another EU country? See which VAT route fits', icon: 'globe', href: 'VATRoute.dc.html', tone: '#0F7B6C', isNew: true },
    { key: 'cyber', name: 'Cyber & AI readiness check', short: '10 questions, a score and your next steps', icon: 'shield', href: 'CyberCheck.dc.html', tone: '#4338CA', isNew: true },
    { key: 'hiring', name: 'Hiring across the EU', short: 'Checklist for hiring abroad or from outside the EU', icon: 'hire', href: 'HiringKit.dc.html', tone: '#C2410C', isNew: true },
    { key: 'calculators', name: 'VAT & late-payment calculators', short: 'Add or remove VAT, claim interest on late invoices', icon: 'calculator', href: 'Calculators.dc.html', tone: '#1E4FA8' },
    { key: 'checkers', name: 'Checkers', short: 'Am I an SME? Do I need e-invoicing?', icon: 'check', href: 'Checkers.dc.html', tone: '#8A3FB8' }
  ];

  // ---- Countries, sample daily news, trending and location detection ----
  var COUNTRIES = [
    ['de', 'Germany', 'hub'], ['fr', 'France', 'hub'], ['it', 'Italy', 'hub'], ['es', 'Spain', 'hub'], ['nl', 'Netherlands', 'hub'], ['pl', 'Poland', 'hub'],
    ['be', 'Belgium', 'light'], ['at', 'Austria', 'light'], ['se', 'Sweden', 'light'], ['ie', 'Ireland', 'light'], ['pt', 'Portugal', 'light'], ['cz', 'Czechia', 'light'],
    ['dk', 'Denmark', 'light'], ['fi', 'Finland', 'light'], ['ro', 'Romania', 'light'], ['gr', 'Greece', 'light'],
    ['bg', 'Bulgaria', 'basic'], ['hr', 'Croatia', 'basic'], ['cy', 'Cyprus', 'basic'], ['ee', 'Estonia', 'basic'], ['hu', 'Hungary', 'basic'], ['lv', 'Latvia', 'basic'],
    ['lt', 'Lithuania', 'basic'], ['lu', 'Luxembourg', 'basic'], ['mt', 'Malta', 'basic'], ['sk', 'Slovakia', 'basic'], ['si', 'Slovenia', 'basic']
  ].map(function (c, i) {
    return { code: c[0], name: c[1], tier: c[2], i: i, flag: 'https://flagcdn.com/w80/' + c[0] + '.png',
      tierLabel: c[2] === 'hub' ? 'Full hub' : c[2] === 'light' ? 'Growing' : 'EU-wide coverage' };
  });
  var BY_CODE = {};
  COUNTRIES.forEach(function (c) { BY_CODE[c.code] = c; });

  // Placeholder headlines for the demo only. Real stories replace these once the news desk is running.
  var NEWS_TPL = [
    ['funding', 'New regional grant round opens for small manufacturers in {C}', 'Applications for the next round of support for small manufacturers are open. Here is who can apply and what to prepare.'],
    ['money', '{C} tax authority publishes new e-invoicing guidance for SMEs', 'The guidance explains formats, timelines and what small businesses should test with their software provider.'],
    ['people', 'Skills shortage tops SME concerns in {C} chamber survey', 'Finding qualified staff is again the most-cited problem for small firms. What owners are doing about it.'],
    ['tech', '{C} launches free cyber security check-ups for small firms', 'A new scheme offers small businesses a free review of their basic security set-up. How to book one.'],
    ['growth', '{C} exporters look to new markets as trade deals take effect', 'Small exporters are reviewing where to sell next. The markets and support programmes worth knowing about.'],
    ['policy', 'How {C} plans to apply the EU’s latest SME simplification rules', 'What changes for reporting and paperwork, and when the new rules are expected to apply.'],
    ['marketing', 'Shoppers in {C} shift towards local brands, retail panel finds', 'What the shift means for small consumer brands and how to position against larger rivals.']
  ];
  var EU_NEWS = [
    ['policy', 'Commission sets out next steps on cutting SME reporting burden', 'An overview of the simplification packages and which changes reach small firms first.'],
    ['funding', 'EU innovation funding: next cut-off dates for SMEs', 'A round-up of open EU calls relevant to small and medium-sized businesses this month.'],
    ['money', 'Cross-border VAT: what small sellers should check this quarter', 'Thresholds, the One-Stop Shop and the SME exemption — a checklist for the quarter.']
  ];
  function dayStart(offset) { var d = new Date(); d.setHours(9, 0, 0, 0); d.setDate(d.getDate() - offset); return d; }
  function hash(str) { var h = 7; for (var i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) % 100003; return h; }
  function newsItem(id, country, tpl, offset, name) {
    var d = dayStart(offset);
    d.setHours(8 + (hash(id) % 9), (hash(id + 'm') % 6) * 10);
    return { id: id, country: country, section: tpl[0], sectionLabel: SECTIONS[tpl[0]].label, color: SECTIONS[tpl[0]].color, type: 'news', sample: true,
      title: tpl[1].replace('{C}', name), excerpt: tpl[2], at: d.getTime(), mins: 2, author: 'European SME News Desk',
      date: d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }),
      time: d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }),
      href: 'Post.dc.html?news=' + id };
  }
  var NEWS = [];
  COUNTRIES.forEach(function (c) {
    // Daily desk: a hub publishes most days, a growing page some days; a day with no story is simply skipped.
    var days = c.tier === 'hub' ? [0, 0, 1, 2, 2, 4, 5, 6] : c.tier === 'light' ? [0, 3] : [];
    days.forEach(function (off, k) {
      var tpl = NEWS_TPL[(c.i + k) % NEWS_TPL.length];
      NEWS.push(newsItem(c.code + '-' + k, c.code, tpl, off, c.name));
    });
  });
  EU_NEWS.forEach(function (tpl, k) { NEWS.push(newsItem('eu-' + k, 'eu', tpl, k, 'EU')); });
  NEWS.sort(function (a, b) { return b.at - a.at; });
  NEWS.forEach(function (n) { n.countryName = n.country === 'eu' ? 'EU-wide' : BY_CODE[n.country].name; n.flag = n.country === 'eu' ? 'https://flagcdn.com/w80/eu.png' : BY_CODE[n.country].flag; });

  function dayLabel(t) {
    var a = dayStart(0), d = new Date(t); d.setHours(9, 0, 0, 0);
    var diff = Math.round((a - d) / 86400000);
    if (diff === 0) return 'Today';
    if (diff === 1) return 'Yesterday';
    return new Date(t).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
  }
  function groupByDay(list) {
    var out = [], cur = null;
    list.forEach(function (n) {
      var l = dayLabel(n.at);
      if (!cur || cur.label !== l) { cur = { label: l, items: [] }; out.push(cur); }
      cur.items.push(n);
    });
    return out;
  }

  var detectPromise = null;
  function validCode(c) { c = (c || '').toLowerCase(); return BY_CODE[c] ? c : null; }
  function detectCountry() {
    if (detectPromise) return detectPromise;
    var fromUrl = validCode(new URLSearchParams(location.search).get('country'));
    if (fromUrl) return (detectPromise = Promise.resolve({ code: fromUrl, source: 'url' }));
    var saved = null;
    try { saved = validCode(localStorage.getItem('esme-country')); } catch (e) { /* storage blocked */ }
    if (saved) return (detectPromise = Promise.resolve({ code: saved, source: 'saved' }));
    function fromBrowser() {
      var langs = navigator.languages || [navigator.language || ''];
      for (var i = 0; i < langs.length; i++) {
        var m = /-([A-Za-z]{2})$/.exec(langs[i] || '');
        if (m && validCode(m[1])) return { code: validCode(m[1]), source: 'browser' };
      }
      return null;
    }
    // On Cloudflare every site answers /cdn-cgi/trace with the visitor's country (loc=XX).
    detectPromise = fetch('/cdn-cgi/trace', { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.text() : ''; })
      .then(function (t) {
        var m = /(?:^|\n)loc=([A-Z]{2})/.exec(t || '');
        var code = m && validCode(m[1]);
        return code ? { code: code, source: 'cloudflare' } : fromBrowser();
      })
      .catch(fromBrowser);
    return detectPromise;
  }
  function setCountry(code) {
    try { if (code) localStorage.setItem('esme-country', code); else localStorage.removeItem('esme-country'); } catch (e) { /* storage blocked */ }
    detectPromise = Promise.resolve(code ? { code: code, source: 'saved' } : null);
  }
  var postsPromise = null;
  window.ESME = {
    sections: SECTIONS,
    icons: ICONS, icon: icon, tools: TOOLS,
    countries: COUNTRIES, country: function (c) { return BY_CODE[(c || '').toLowerCase()] || null; },
    news: NEWS, newsById: function (id) { return NEWS.filter(function (n) { return n.id === id; })[0] || null; },
    newsFor: function (code) { return NEWS.filter(function (n) { return !code || n.country === code; }); },
    groupByDay: groupByDay, dayLabel: dayLabel,
    // Demo ranking: stands in for real view counts until analytics are connected.
    trending: function (code, posts) {
      var pool = NEWS.filter(function (n) { return n.country === code || n.country === 'eu'; }).concat((posts || []).slice(0, 30));
      return pool.map(function (p) { return { p: p, v: hash((code || 'eu') + (p.id || p.slug)) % 900 + (p.type === 'news' ? 400 : 0) }; })
        .sort(function (a, b) { return b.v - a.v; }).slice(0, 5)
        .map(function (x, i) { return { n: String(i + 1), views: x.v.toLocaleString('en-GB') + ' reads', post: x.p }; });
    },
    detectCountry: detectCountry, setCountry: setCountry,
    sectionIcon: function (k) { return icon(k, 18); },
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

/* Template switcher badge (review only) */
(function () {
  function add() {
    if (document.getElementById('esme-tpl')) return;
    var a = document.createElement('div');
    a.id = 'esme-tpl';
    a.setAttribute('style', 'position:fixed;left:16px;bottom:16px;z-index:9999;display:flex;align-items:center;gap:10px;padding:8px 8px 8px 14px;border-radius:999px;background:#101828;color:#fff;font:600 13px Sora,Arial,sans-serif;box-shadow:0 10px 30px -10px rgba(0,0,0,.6)');
    a.innerHTML = 'Template 1<a href="../Main.dc.html" style="padding:6px 12px;border-radius:999px;background:#FFCC00;color:#101828;text-decoration:none">View Template 2</a><a href="../templates.html" style="color:#C8CDD6;text-decoration:none;padding-right:6px">All</a>';
    document.body.appendChild(a);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', add); else add();
})();
