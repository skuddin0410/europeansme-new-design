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
    var deferredValue;
    for (k = 0; k < n.attrs.length; k++) {
      var name = n.attrs[k][0], raw = n.attrs[k][1];
      if (/^on[A-Z]/.test(name)) {
        var fn = attrValue(raw, scope);
        if (typeof fn === 'function') el.addEventListener(name.slice(2).toLowerCase(), fn);
        continue;
      }
      var val = attrValue(raw, scope);
      if (name === 'value' && (lower === 'input' || lower === 'select' || lower === 'textarea')) {
        deferredValue = val == null ? '' : String(val);
        if (lower === 'input') el.setAttribute('value', deferredValue);
        continue;
      }
      if (val === false || val == null) continue;
      el.setAttribute(name, val === true ? '' : String(val));
    }
    if (n.raw !== undefined) el.textContent = n.raw;
    else renderNodes(n.children, scope, el, isSvg && lower !== 'foreignobject');
    if (deferredValue !== undefined) el.value = deferredValue;
    parent.appendChild(el);
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
          var active = document.activeElement, id = active && root.contains(active) ? active.id : null, sel = null;
          if (id) { try { sel = [active.selectionStart, active.selectionEnd]; } catch (e) { sel = null; } }
          var frag = document.createDocumentFragment();
          renderNodes(def.nodes, inst.renderVals() || {}, frag, false);
          root.replaceChildren(frag);
          if (id) {
            var again = document.getElementById(id);
            if (again) {
              again.focus({ preventScroll: true });
              if (sel && sel[0] != null) { try { again.setSelectionRange(sel[0], sel[1]); } catch (e) { /* number inputs */ } }
            }
          }
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

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
  else mount();
})();
