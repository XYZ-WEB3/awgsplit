'use strict';
'require baseclass';
'require rpc';
'require ui';
'require uci';
'require dom';

// Общие помощники веб-интерфейса awgsplit: вызовы rpcd, стили, значки, проверки ввода, работа с uci.
// Подключается во вкладках строкой 'require view.awgsplit.common as awg'.

var CONF = 'awgsplit';
var MAX_TUNNELS = 10, MAX_GROUPS = 10, MAX_MEMBERS = 10;

function decl(method, params, expect) {
	return rpc.declare({
		object: 'luci.awgsplit',
		method: method,
		params: params || [],
		expect: expect || { }
	});
}

var callStatus     = decl('status');
var callUpdate     = decl('update');
var callRestart    = decl('restart');
var callSetDefault = decl('set_default', [ 'mode', 'group' ]);
var callSetActive  = decl('set_active', [ 'group', 'tunnel' ]);
var callTestNotify = decl('test_notify');
var callPages      = decl('pages');
var callSetPage    = decl('set_page', [ 'file' ]);
var callUploadPage = decl('upload_page', [ 'name' ]);
var callInterfaces = decl('interfaces', [], { interfaces: [] });
var callImport     = decl('import_conf', [ 'conf', 'name' ]);
var callExplain    = decl('explain', [ 'target' ]);
var callDump       = decl('dump', [ 'tunnel' ]);

// Готовые списки itdoginfo/allow-domains (те же, что в Podkop)
var COMMUNITY = [
	[ 'russia_inside',  'Россия внутри', 'заблокированное в РФ + зарубежные сервисы, закрытые для РФ-IP' ],
	[ 'russia_outside', 'Россия снаружи', 'российские сервисы, доступные только с РФ-IP (для роутера за границей)' ],
	[ 'telegram',       'Telegram', 'домены + подсети' ],
	[ 'meta',           'Meta', 'Instagram, Facebook, WhatsApp' ],
	[ 'twitter',        'Twitter / X', 'домены + подсети' ],
	[ 'discord',        'Discord', 'включая голосовые подсети' ],
	[ 'youtube',        'YouTube', '' ],
	[ 'tiktok',         'TikTok', '' ],
	[ 'google_ai',      'Google AI', 'Gemini, AI Studio' ],
	[ 'google_play',    'Google Play', '' ],
	[ 'google_meet',    'Google Meet', 'домены + подсети' ],
	[ 'cloudflare',     'Cloudflare', 'домены + подсети' ],
	[ 'cloudfront',     'Amazon CloudFront', 'домены + подсети' ],
	[ 'hdrezka',        'HDRezka', '' ],
	[ 'roblox',         'Roblox', 'домены + подсети' ],
	[ 'digitalocean',   'DigitalOcean', 'домены + подсети' ],
	[ 'hetzner',        'Hetzner', 'домены + подсети' ],
	[ 'ovh',            'OVH', 'домены + подсети' ],
	[ 'geoblock',       'Геоблок', 'сервисы, закрывшие доступ из РФ' ],
	[ 'block',          'Заблокированные в РФ', 'категория' ],
	[ 'news',           'Новости', '' ],
	[ 'anime',          'Аниме', '' ],
	[ 'porn',           'Для взрослых', '' ],
	[ 'hodca',          'HODCA', '' ]
];

// Готовые списки, которые идут напрямую (исключения). russia_inside сюда НЕ годится.
var BYPASS_COMMUNITY = [
	[ 'lib4u_ru', 'Российские сервисы (lib4u)', '~2200 доменов: банки, Госуслуги, маркетплейсы, Яндекс, VK, СМИ; обновляется ежедневно' ],
	[ 'russia_outside', 'Россия снаружи', 'российские сервисы, закрытые для зарубежных IP (Госуслуги, Озон, Яндекс-CDN и др.)' ]
];

var RE_SECTION = /^[A-Za-z][A-Za-z0-9_]{0,23}$/;
var RE_IP4 = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;

// ---------------------------------------------------------------- стили (один раз на страницу)
var CSS = [
	'.awg-wrap{--awg-line:rgba(128,128,128,.38);--awg-soft:rgba(128,128,128,.08);--awg-blue:#1f6fb2}',
	'.awg-wrap h2{margin-bottom:.3em}',
	'.awg-lead{opacity:.8;margin:0 0 1em;max-width:62em}',
	'.awg-card{border:1px solid var(--awg-line);border-radius:10px;padding:14px 16px;margin:0 0 16px;background:var(--awg-soft)}',
	'.awg-card>h3{margin:0 0 .6em;padding:0;border:0;font-size:1.15em}',
	'.awg-card h4{margin:0;font-size:1.05em}',
	'.awg-muted{opacity:.75;font-size:92%}',
	'.awg-small{font-size:88%}',
	'.awg-badge{display:inline-block;padding:1px 9px;border-radius:10px;font-weight:600;font-size:88%;line-height:1.65;white-space:nowrap;vertical-align:middle}',
	'.awg-ok{background:#1e7e34;color:#fff}',
	'.awg-warn{background:#f0ad4e;color:#1b1b1b}',
	'.awg-bad{background:#c62828;color:#fff}',
	'.awg-off{background:#6c757d;color:#fff}',
	'.awg-info{background:#1f6fb2;color:#fff}',
	'.awg-banner{border:1px solid var(--awg-line);border-left-width:6px;border-radius:8px;padding:8px 12px;margin:0 0 12px}',
	'.awg-banner p{margin:.3em 0 0}',
	'.awg-banner-ok{border-color:#1e7e34;background:rgba(30,126,52,.10)}',
	'.awg-banner-warn{border-color:#f0ad4e;background:rgba(240,173,78,.14)}',
	'.awg-banner-bad{border-color:#c62828;background:rgba(198,40,40,.11)}',
	'.awg-banner-info{border-color:#1f6fb2;background:rgba(31,111,178,.10)}',
	'.awg-row{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:6px 0}',
	'.awg-row>.awg-grow{flex:1 1 14em;min-width:0}',
	'.awg-grid{display:flex;flex-wrap:wrap;gap:16px;align-items:stretch}',
	'.awg-grid>*{flex:1 1 360px;min-width:0}',
	'.awg-panel{border:1px solid var(--awg-line);border-left:6px solid #6c757d;border-radius:10px;padding:12px 14px;margin:0 0 14px}',
	'.awg-s-ok{border-left-color:#1e7e34}.awg-s-warn{border-left-color:#f0ad4e}.awg-s-bad{border-left-color:#c62828}.awg-s-info{border-left-color:#1f6fb2}',
	'.awg-head{display:flex;flex-wrap:wrap;gap:8px;align-items:center;justify-content:space-between;margin-bottom:6px}',
	'.awg-head>.awg-title{display:flex;flex-wrap:wrap;gap:8px;align-items:center}',
	'.awg-kv{display:grid;grid-template-columns:minmax(9em,max-content) 1fr;gap:6px 18px;align-items:baseline}',
	'.awg-kv>.awg-k{font-weight:600}',
	'.awg-chain{display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin:10px 0}',
	'.awg-chip{border:1px solid var(--awg-line);border-radius:8px;padding:6px 10px;min-width:9.5em;max-width:100%}',
	'.awg-chip>div{margin:2px 0}',
	'.awg-chip.awg-active{border:2px solid var(--awg-blue);box-shadow:0 0 0 3px rgba(31,111,178,.18)}',
	'.awg-arrow{opacity:.55;font-size:1.3em;padding:0 2px}',
	'.awg-num{display:inline-flex;min-width:1.7em;height:1.7em;border-radius:50%;align-items:center;justify-content:center;font-weight:700;background:#1f6fb2;color:#fff;font-size:88%;flex:none}',
	'.awg-member{display:flex;flex-wrap:wrap;align-items:center;gap:8px;padding:6px 8px;border:1px solid var(--awg-line);border-radius:8px;margin:4px 0}',
	'.awg-member>.awg-grow{flex:1 1 10em;min-width:0}',
	'.awg-field{display:flex;flex-direction:column;gap:3px;margin:8px 0;min-width:0}',
	'.awg-field>label{font-weight:600}',
	'.awg-fields{display:flex;flex-wrap:wrap;gap:0 16px}',
	'.awg-fields>.awg-field{flex:1 1 15em}',
	'.awg-wrap input[type=text],.awg-wrap input[type=password],.awg-wrap input[type=number],.awg-wrap select,.awg-wrap textarea{max-width:100%;box-sizing:border-box}',
	'.awg-wrap textarea{width:100%;font-family:monospace}',
	'.awg-checks{display:grid;grid-template-columns:repeat(auto-fill,minmax(15em,1fr));gap:4px 14px;margin:6px 0}',
	'.awg-check{display:flex;gap:7px;align-items:flex-start;cursor:pointer;line-height:1.35}',
	'.awg-check>input{margin-top:.2em;flex:none}',
	'.awg-check.awg-dis{cursor:default;opacity:.55}',
	'.awg-err{display:none;border-left:4px solid #c62828;background:rgba(198,40,40,.11);padding:2px 8px;border-radius:4px;font-size:92%}',
	'.awg-err.awg-show{display:block}',
	'.awg-invalid{border-color:#c62828!important;box-shadow:0 0 0 2px rgba(198,40,40,.25)!important}',
	'.awg-btns{display:flex;flex-wrap:wrap;gap:6px;align-items:center}',
	'.awg-seg{display:flex;flex-wrap:wrap;gap:6px}',
	'.awg-seg .btn{white-space:normal;text-align:left}',
	'.awg-pre{background:#1e1e1e;color:#ecf0f1;padding:12px;max-height:500px;overflow:auto;font-size:12px;white-space:pre-wrap;border-radius:6px;margin:8px 0 0}',
	'.awg-wrap details>summary{cursor:pointer;font-weight:600;margin:6px 0}',
	'.awg-flow{display:flex;flex-wrap:wrap;gap:10px;align-items:center}',
	'.awg-flow-src{display:flex;align-items:center;gap:8px;flex:0 1 auto}',
	'.awg-flow-dst{display:flex;flex-direction:column;gap:6px;flex:1 1 300px;min-width:0}',
	'.awg-flow-row{display:flex;flex-wrap:wrap;gap:6px;align-items:center}',
	'.awg-box{border:1px solid var(--awg-line);border-radius:8px;padding:5px 10px;background:var(--awg-soft)}',
	'.awg-box-ok{border-color:#1e7e34}.awg-box-info{border-color:#1f6fb2}.awg-box-off{border-style:dashed}',
	'.awg-bubble{background:#effdde;color:#111;border-radius:12px 12px 12px 3px;padding:8px 12px;white-space:pre-wrap;word-break:break-word;max-width:34em;box-shadow:0 1px 2px rgba(0,0,0,.25);font-size:95%}',
	'.awg-ph{font-family:monospace;cursor:pointer}',
	'.awg-steps{margin:.3em 0 .3em 1.4em}',
	'.awg-steps li{margin:4px 0}',
	'.awg-count{font-weight:600}',
	'@media (max-width:600px){.awg-kv{grid-template-columns:1fr;gap:2px}.awg-kv>.awg-k{margin-top:6px}.awg-card{padding:12px 10px}.awg-chip{min-width:0;flex:1 1 100%}.awg-arrow{display:none}}'
].join('\n');

function ensureStyle() {
	if (document.getElementById('awg-style')) return;
	var st = document.createElement('style');
	st.id = 'awg-style';
	st.appendChild(document.createTextNode(CSS));
	(document.head || document.documentElement).appendChild(st);
}

// ---------------------------------------------------------------- мелкие помощники разметки
// Любые строки, особенно пришедшие от роутера, передаются в E() только массивом — тогда они вставляются текстом, не HTML.
function txt(v) { return [ String(v == null ? '' : v) ]; }

function badge(kind, text) {
	return E('span', { 'class': 'awg-badge awg-' + (kind || 'off') }, txt(text));
}

function banner(kind, title, body) {
	return E('div', { 'class': 'awg-banner awg-banner-' + kind, 'role': kind === 'bad' ? 'alert' : null }, [
		E('strong', {}, txt(title)),
		body ? E('p', {}, Array.isArray(body) ? body : txt(body)) : ''
	]);
}

function card(title, children, cls) {
	return E('div', { 'class': 'cbi-section awg-card' + (cls ? ' ' + cls : '') },
		[ title ? E('h3', {}, txt(title)) : '' ].concat(children || []));
}

function muted(text, tag) { return E(tag || 'p', { 'class': 'awg-muted' }, txt(text)); }

function note(msg, kind) {
	ui.addNotification(null, E('p', {}, txt(msg)), kind || 'info');
}

function page(title, lead, children) {
	ensureStyle();
	return E('div', { 'class': 'awg-wrap' }, [
		E('h2', {}, txt(title)),
		lead ? E('p', { 'class': 'awg-lead' }, txt(lead)) : ''
	].concat(children || []));
}

function kv(rows) {
	var out = [];
	rows.forEach(function(r) {
		if (!r) return;
		out.push(E('div', { 'class': 'awg-k' }, txt(r[0])));
		out.push(E('div', {}, Array.isArray(r[1]) ? r[1] : [ r[1] ]));
	});
	return E('div', { 'class': 'awg-kv' }, out);
}

// Обновить содержимое узла, только если данные изменились и пользователь сейчас не работает с полем внутри.
function patch(node, data, build) {
	var sig = JSON.stringify(data);
	if (node.__awgSig === sig) return false;
	var a = document.activeElement;
	if (a && a !== document.body && node.contains(a) && /^(SELECT|INPUT|TEXTAREA)$/.test(a.tagName)) return false;
	dom.content(node, build());
	node.__awgSig = sig;
	return true;
}

// ---------------------------------------------------------------- форматирование
var TSTATE = {
	up:      [ 'ok',   '● Работает' ],
	pending: [ 'warn', '◐ Подключается' ],
	unknown: [ 'off',  '○ Нет данных' ],
	down:    [ 'bad',  '✕ Нет связи' ],
	nodev:   [ 'bad',  '✕ Интерфейс не поднят' ],
	off:     [ 'off',  '○ Выключен' ]
};

function tunnelBadge(state) {
	var s = TSTATE[state] || [ 'off', '○ ' + (state || 'нет данных') ];
	return badge(s[0], s[1]);
}

function fmtDur(sec) {
	sec = Math.max(0, Math.floor(+sec || 0));
	if (sec < 60) return sec + ' с';
	if (sec < 3600) { var s = sec % 60; return Math.floor(sec / 60) + ' мин' + (s ? ' ' + s + ' с' : ''); }
	if (sec < 86400) { var m = Math.floor(sec % 3600 / 60); return Math.floor(sec / 3600) + ' ч' + (m ? ' ' + m + ' мин' : ''); }
	return Math.floor(sec / 86400) + ' дн ' + Math.floor(sec % 86400 / 3600) + ' ч';
}

function fmtHandshake(age) {
	if (age == null || age === '' || +age < 0 || isNaN(+age)) return 'рукопожатия ещё не было';
	return 'рукопожатие ' + fmtDur(age) + ' назад';
}

function fmtAgo(ts) {
	if (!ts || ts <= 0) return 'никогда';
	var d = Math.floor(Date.now() / 1000) - ts;
	if (d < 60) return 'только что';
	return fmtDur(d) + ' назад';
}

// ---------------------------------------------------------------- проверки ввода
function parseMark(v) {
	v = String(v == null ? '' : v).trim();
	var n = NaN;
	if (/^0x[0-9a-f]{1,8}$/i.test(v)) n = parseInt(v, 16);
	else if (/^[1-9][0-9]{0,9}$/.test(v)) n = parseInt(v, 10);
	return (n > 0 && n <= 0xffffffff) ? n : NaN;
}

function normDomain(d) {
	d = d.toLowerCase().replace(/^\*\./, '').replace(/^\.+/, '').replace(/\.+$/, '');
	if (!d || d.length > 253 || /[^a-z0-9.-]/.test(d)) return null;
	var labels = d.split('.');
	for (var i = 0; i < labels.length; i++)
		if (!labels[i].length || labels[i].length > 63 || /^-|-$/.test(labels[i])) return null;
	return d;
}

function domainTokens(text) {
	var out = [];
	String(text || '').split(/\n/).forEach(function(line) {
		line.replace(/#.*/, '').split(/[\s,;]+/).forEach(function(t) {
			if (t) out.push(t);
		});
	});
	return out;
}

function validDomainsText(value) {
	var bad = domainTokens(value).filter(function(t) { return normDomain(t) === null; });
	if (bad.length)
		return 'Некорректные записи: ' + bad.slice(0, 3).join(', ') + (bad.length > 3 ? ' и ещё ' + (bad.length - 3) : '');
	return true;
}

function validCidr(value) {
	if (!value) return true;
	var p = String(value).split('/');
	if (p.length > 2 || !RE_IP4.test(p[0])) return 'Нужен IPv4-адрес или подсеть';
	if (p.length === 2 && !(/^\d{1,2}$/.test(p[1]) && +p[1] <= 32)) return 'Маска подсети 0..32';
	return true;
}

// Текст «одна запись на строку / через пробел или запятую» → массив
function splitTokens(text) {
	return String(text || '').split(/[\s,;]+/).filter(function(t) { return t.length; });
}

function validCidrText(text) {
	var bad = splitTokens(text).filter(function(t) { return validCidr(t) !== true; });
	return bad.length ? 'Не похоже на IPv4-адрес или подсеть: ' + bad.slice(0, 3).join(', ') : true;
}

function validIp4Text(text) {
	var bad = splitTokens(text).filter(function(t) { return !RE_IP4.test(t); });
	return bad.length ? 'Нужны IPv4-адреса через запятую: ' + bad.slice(0, 3).join(', ') : true;
}

// ---------------------------------------------------------------- uci
function list(v) {
	if (Array.isArray(v)) return v.slice();
	if (v == null || v === '') return [];
	return [ String(v) ];
}

function setOpt(sid, opt, val) {
	if (val == null || val === '' || (Array.isArray(val) && !val.length)) uci.unset(CONF, sid, opt);
	else uci.set(CONF, sid, opt, val);
}

function sections(type) { return uci.sections(CONF, type); }

function sectionLabel(s) { return (s && (s.label || s['.name'])) || ''; }

function uniqueName(prefix) {
	var used = {};
	uci.sections(CONF).forEach(function(s) { used[s['.name']] = true; });
	for (var i = 1; i < 1000; i++)
		if (!used[prefix + i]) return prefix + i;
	return prefix + Date.now();
}

function nextFree(type, key, parse, from, to, skip) {
	var used = {};
	uci.sections(CONF, type).forEach(function(s) { if (s['.name'] !== skip) used[parse(s[key])] = true; });
	for (var i = from; i <= to; i++)
		if (!used[i]) return i;
	return from;
}

// ---------------------------------------------------------------- поле ввода с проверкой
// Регистрирует проверку в checks (массив), показывает ошибку под полем сразу при вводе.
function bindField(checks, input, opts) {
	var err = E('div', { 'class': 'awg-err', 'role': 'alert' });
	function run() {
		var r = opts.validate ? opts.validate(input.type === 'checkbox' ? input.checked : input.value) : true;
		var bad = (r !== true && r != null);
		input.classList.toggle('awg-invalid', bad);
		err.classList.toggle('awg-show', bad);
		dom.content(err, bad ? txt('⚠ ' + r) : []);
		return bad ? (opts.name ? opts.name + ': ' : '') + r : null;
	}
	function onChange() {
		if (opts.set) opts.set(input.type === 'checkbox' ? input.checked : input.value);
		run();
		if (opts.after) opts.after();
	}
	input.addEventListener(input.tagName === 'SELECT' || input.type === 'checkbox' || input.type === 'radio' ? 'change' : 'input', onChange);
	if (checks) checks.push({ node: input, run: run });
	return err;
}

var fieldSeq = 0;
function fid() { return 'awg-f' + (++fieldSeq); }

function field(labelText, input, helpText, errNode) {
	if (!input.id) input.id = fid();
	return E('div', { 'class': 'awg-field' }, [
		E('label', { 'for': input.id }, txt(labelText)),
		input,
		errNode || '',
		helpText ? E('div', { 'class': 'awg-muted awg-small' }, Array.isArray(helpText) ? helpText : txt(helpText)) : ''
	]);
}

function checkbox(labelText, checked, onchange, helpText, disabled) {
	var cb = E('input', { 'type': 'checkbox', 'checked': checked ? '' : null, 'disabled': disabled ? '' : null });
	if (onchange) cb.addEventListener('change', function() { onchange(cb.checked); });
	return E('label', { 'class': 'awg-check' + (disabled ? ' awg-dis' : '') }, [
		cb,
		E('span', {}, [ E('span', {}, txt(labelText)) ].concat(helpText ?
			[ E('br'), E('span', { 'class': 'awg-muted awg-small' }, txt(helpText)) ] : []))
	]);
}

function select(options, value, attrs) {
	var a = Object.assign({ 'class': 'cbi-input-select' }, attrs || {});
	return E('select', a, options.map(function(o) {
		return E('option', { 'value': o[0], 'selected': String(o[0]) === String(value == null ? '' : value) ? '' : null }, txt(o[1]));
	}));
}

function button(label, cls, handler, attrs) {
	var a = Object.assign({ 'class': 'btn ' + (cls || 'cbi-button-neutral'), 'type': 'button' }, attrs || {});
	if (handler) a.click = ui.createHandlerFn(null, handler);
	return E('button', a, txt(label));
}

// Прогнать все проверки; вернуть список ошибок. Вкладки пересоздают массив checks при каждой перерисовке.
function runChecks(checks) {
	var errs = [];
	checks.forEach(function(c) { var r = c.run(); if (r) errs.push(r); });
	return errs;
}

function showErrors(errs) {
	ui.addNotification('Не сохранено: исправьте ошибки', E('ul', {}, errs.slice(0, 12).map(function(e) {
		return E('li', {}, txt(e));
	})), 'danger');
}

// Сохранить изменения uci в сессию LuCI (кнопки «Сохранить» / «Сохранить и применить» внизу страницы)
function saveUci() {
	return uci.save().then(function() {
		try { if (ui.changes && ui.changes.init) ui.changes.init(); } catch (e) {}
	});
}

function rpcError(e) { note('Не удалось: ' + (e && e.message ? e.message : e), 'danger'); }

// Плашка «есть несохранённые изменения» над содержимым вкладки
function dirtyMarker() {
	var node = E('div', { 'aria-live': 'polite' });
	var on = false;
	return {
		node: node,
		mark: function() {
			if (on) return;
			on = true;
			dom.content(node, banner('info', '✎ Есть несохранённые изменения',
				'Они начнут работать после кнопки «Сохранить и применить» внизу страницы.'));
		},
		clear: function() { on = false; dom.content(node, []); },
		get dirty() { return on; }
	};
}

// Стандартная пара обработчиков для вкладок, которые сами пишут в uci:
// при ошибках ввода ничего не сохраняется и не применяется.
function saveHandlers(redraw) {
	return {
		handleSave: function() {
			var errs = runChecks(this.checks || []);
			if (this.extraChecks) errs = errs.concat(this.extraChecks());
			if (errs.length) { showErrors(errs); return Promise.resolve(false); }
			if (this.beforeSave) this.beforeSave();
			var self = this;
			return saveUci().then(function() {
				if (self.marker) self.marker.clear();
				if (redraw) self[redraw]();
				return true;
			});
		},
		handleSaveApply: function(ev, mode) {
			return this.handleSave(ev).then(function(ok) {
				if (ok) ui.changes.apply(mode == '0');
			});
		},
		handleReset: function() {
			var self = this;
			uci.unload(CONF);
			return uci.load(CONF).then(function() {
				if (self.marker) self.marker.clear();
				if (redraw) self[redraw]();
			});
		}
	};
}

return baseclass.extend({
	CONF: CONF,
	MAX_TUNNELS: MAX_TUNNELS,
	MAX_GROUPS: MAX_GROUPS,
	MAX_MEMBERS: MAX_MEMBERS,
	COMMUNITY: COMMUNITY,
	BYPASS_COMMUNITY: BYPASS_COMMUNITY,
	RE_SECTION: RE_SECTION,
	RE_IP4: RE_IP4,

	callStatus: callStatus,
	callUpdate: callUpdate,
	callRestart: callRestart,
	callSetDefault: callSetDefault,
	callSetActive: callSetActive,
	callTestNotify: callTestNotify,
	callPages: callPages,
	callSetPage: callSetPage,
	callUploadPage: callUploadPage,
	callInterfaces: callInterfaces,
	callImport: callImport,
	callExplain: callExplain,
	callDump: callDump,

	ensureStyle: ensureStyle,
	txt: txt,
	badge: badge,
	banner: banner,
	card: card,
	muted: muted,
	note: note,
	page: page,
	kv: kv,
	patch: patch,
	tunnelBadge: tunnelBadge,
	fmtDur: fmtDur,
	fmtHandshake: fmtHandshake,
	fmtAgo: fmtAgo,

	parseMark: parseMark,
	normDomain: normDomain,
	domainTokens: domainTokens,
	validDomainsText: validDomainsText,
	validCidr: validCidr,
	validCidrText: validCidrText,
	validIp4Text: validIp4Text,
	splitTokens: splitTokens,

	list: list,
	setOpt: setOpt,
	sections: sections,
	sectionLabel: sectionLabel,
	uniqueName: uniqueName,
	nextFree: nextFree,

	bindField: bindField,
	field: field,
	fid: fid,
	checkbox: checkbox,
	select: select,
	button: button,
	runChecks: runChecks,
	showErrors: showErrors,
	saveUci: saveUci,
	rpcError: rpcError,
	dirtyMarker: dirtyMarker,
	saveHandlers: saveHandlers
});
