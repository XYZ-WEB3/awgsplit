'use strict';
'require view';
'require ui';
'require uci';
'require dom';
'require view.awgsplit.common as awg';

var txt = awg.txt;
var CONF = awg.CONF;
var DIRECT = '__direct__';
var BYPASS_OWNER = '__bypass__';

function groups() { return awg.sections('group'); }
function tunnels() { return awg.sections('tunnel'); }
function gl(sid) { return awg.sectionLabel(uci.get(CONF, sid)) || sid; }
function exists(type, sid) { var s = sid && uci.get(CONF, sid); return !!(s && s['.type'] === type); }

// Кто «владеет» готовым списком: группы и/или исключения
function owners(id) {
	var out = [];
	groups().forEach(function(g) { if (awg.list(g.community_lists).indexOf(id) >= 0) out.push(g['.name']); });
	if (awg.list(uci.get(CONF, 'global', 'bypass_lists')).indexOf(id) >= 0) out.push(BYPASS_OWNER);
	return out;
}

function ownerName(o) { return o === BYPASS_OWNER ? 'в исключениях' : 'в группе «' + gl(o) + '»'; }

var MARK = [ 'fwmark', awg.parseMark, 0x1001, 0x10ff ];
var TABLE = [ 'table', function(v) { return /^[1-9][0-9]{0,2}$/.test(String(v)) ? +v : NaN; }, 101, 252 ];
var PRIO = [ 'priority', function(v) { return /^[1-9][0-9]{1,4}$/.test(String(v)) ? +v : NaN; }, 101, 32765 ];

function fillAuto(sid) {
	[ MARK, TABLE, PRIO ].forEach(function(k) {
		var cur = uci.get(CONF, sid, k[0]);
		if (cur != null && cur !== '' && !isNaN(k[1](cur))) return;
		var n = awg.nextFree('group', k[0], k[1], k[2], k[3], sid);
		uci.set(CONF, sid, k[0], k[0] === 'fwmark' ? '0x' + n.toString(16) : String(n));
	});
}

return view.extend(Object.assign({
	load: function() {
		return uci.load(CONF);
	},

	render: function() {
		if (!uci.get(CONF, 'global')) uci.add(CONF, 'awgsplit', 'global');
		this.marker = awg.dirtyMarker();
		this.open = {};
		this.listOrder = [];
		this.restBox = E('div');
		this.groupsBox = E('div');
		this.listsBox = E('div');
		this.bypassBox = E('div');

		var root = awg.page('Группы и списки', 'Здесь решается, какие сайты через какой VPN идут.', [
			awg.card('Главное правило', [
				E('div', { 'class': 'awg-flow', 'style': 'margin-bottom:10px' }, [
					E('span', { 'class': 'awg-box' }, txt('Список сайтов')),
					E('span', { 'class': 'awg-arrow' }, txt('→')),
					E('span', { 'class': 'awg-box awg-box-info' }, txt('Группа')),
					E('span', { 'class': 'awg-arrow' }, txt('→')),
					E('span', { 'class': 'awg-box' }, txt('Туннель №1 › №2 › №3 …'))
				]),
				E('ul', { 'class': 'awg-steps' }, [
					E('li', {}, txt('Группа — это «направление», например «США» или «Европа». В ней один или несколько туннелей.')),
					E('li', {}, txt('Порядок туннелей в группе — это приоритет: №1 основной, остальные — запасные по очереди.')),
					E('li', {}, txt('Каждый список сайтов идёт ровно в одну группу — или «Напрямую», мимо VPN.')),
					E('li', {}, txt('Внутренние адреса (192.168.x.x, 10.x, 172.16–31.x) всегда идут напрямую: роутер, принтер и соседние устройства доступны всегда.'))
				])
			]),
			this.marker.node,
			this.restBox,
			this.groupsBox,
			this.listsBox,
			this.bypassBox
		]);

		this.draw();
		return root;
	},

	changed: function() { this.marker.mark(); },

	details: function(key, summary, children) {
		var self = this;
		var d = E('details', { 'open': this.open[key] ? '' : null }, [ E('summary', {}, summary) ].concat(children));
		d.addEventListener('toggle', function() { self.open[key] = d.open; });
		return d;
	},

	draw: function() {
		this.checks = [];
		this.commBoxes = [];
		dom.content(this.restBox, this.restCard());
		dom.content(this.groupsBox, this.groupsCard());
		dom.content(this.listsBox, this.listsCard());
		dom.content(this.bypassBox, this.bypassCard());
		this.refreshCommunity();
	},

	// ---------------------------------------------------------------- «всё остальное»: режим и группа по умолчанию
	restCard: function() {
		var self = this;
		var mode = uci.get(CONF, 'global', 'mode') === 'full' ? 'full' : 'split';
		var gname = 'awg-mode';

		function radio(val, title, help) {
			var r = E('input', { 'type': 'radio', 'name': gname, 'value': val, 'checked': mode === val ? '' : null });
			r.addEventListener('change', function() {
				if (!r.checked) return;
				uci.set(CONF, 'global', 'mode', val);
				if (val === 'full' && !uci.get(CONF, 'global', 'full_group') && groups().length)
					uci.set(CONF, 'global', 'full_group', groups()[0]['.name']);
				self.changed();
				dom.content(self.restBox, self.restCard());
			});
			return E('label', { 'class': 'awg-check', 'style': 'margin:6px 0' }, [ r, E('span', {}, [
				E('strong', {}, txt(title)), E('br'), E('span', { 'class': 'awg-muted awg-small' }, txt(help)) ]) ]);
		}

		var gopts = [ [ '', '— выберите группу —' ] ].concat(groups().map(function(g) { return [ g['.name'], awg.sectionLabel(g) ]; }));
		var cur = uci.get(CONF, 'global', 'full_group') || '';
		if (cur && !exists('group', cur)) gopts.push([ cur, cur + ' (группа не найдена)' ]);
		var gsel = awg.select(gopts, cur);
		gsel.addEventListener('change', function() { awg.setOpt('global', 'full_group', gsel.value); self.changed(); });

		var ks = awg.checkbox('Kill switch для «всего остального»', uci.get(CONF, 'global', 'full_killswitch') !== '0', function(v) {
			uci.set(CONF, 'global', 'full_killswitch', v ? '1' : '0'); self.changed();
		}, 'Если у выбранной группы не работает ни один туннель — всё, кроме исключений, блокируется, а не идёт напрямую через провайдера.');

		return awg.card('Куда идёт всё остальное', [
			radio('split', 'Раздельный режим', 'Через VPN идут только сайты из списков групп. Всё остальное — напрямую через провайдера.'),
			radio('full', 'Полный режим', 'Через VPN идёт всё, кроме исключений (российские сервисы и ваши списки «Напрямую»). ' +
				'DNS тоже идёт внутри туннеля, IPv6 вне исключений отключается.'),
			mode === 'full' ? E('div', { 'class': 'awg-fields' }, [
				awg.field('Всё остальное идёт через группу', gsel, 'Сайты из списков других групп всё равно идут через свои группы. Переключать можно и на «Обзоре».'),
				E('div', { 'class': 'awg-field' }, [ ks ])
			]) : ''
		]);
	},

	// ---------------------------------------------------------------- группы
	groupsCard: function() {
		var self = this;
		var list = groups();
		var full = list.length >= awg.MAX_GROUPS;
		return awg.card('Группы', [
			list.length ? '' : awg.banner('info', 'Групп пока нет', 'Нажмите «Добавить группу», выберите туннели и отметьте, какие сайты через неё пускать.'),
			E('div', {}, list.map(function(g) { return self.groupPanel(g); })),
			E('div', { 'class': 'awg-row' }, [
				E('button', { 'type': 'button', 'class': 'btn cbi-button-add', 'disabled': full ? '' : null,
					'click': function() { self.addGroup(); } }, txt('+ Добавить группу')),
				E('span', { 'class': 'awg-count' }, txt('Групп: ' + list.length + ' из ' + awg.MAX_GROUPS)),
				full ? E('span', { 'class': 'awg-muted awg-small' }, txt('Достигнут максимум — удалите ненужную группу, чтобы добавить новую.')) : ''
			])
		]);
	},

	addGroup: function() {
		if (groups().length >= awg.MAX_GROUPS) return;
		var sid = awg.uniqueName('grp');
		uci.add(CONF, 'group', sid);
		uci.set(CONF, sid, 'enabled', '1');
		uci.set(CONF, sid, 'label', 'Группа ' + (groups().length));
		uci.set(CONF, sid, 'failback', 'auto');
		uci.set(CONF, sid, 'failback_delay', '120');
		uci.set(CONF, sid, 'killswitch', '1');
		var t = tunnels().filter(function(x) { return x.enabled !== '0'; })[0];
		if (t) uci.set(CONF, sid, 'tunnel', [ t['.name'] ]);
		fillAuto(sid);
		this.open['g:' + sid + ':lists'] = true;
		this.changed();
		this.draw();
	},

	removeGroup: function(sid) {
		var self = this;
		var lists = awg.sections('domains').filter(function(d) { return d.group === sid; });
		ui.showModal('Удалить группу «' + gl(sid) + '»?', [
			E('p', {}, txt('Готовые списки и подсети группы удалятся вместе с ней. Туннели останутся.')),
			lists.length ? awg.banner('warn', 'Свои списки этой группы останутся без направления',
				lists.map(function(d) { return '«' + awg.sectionLabel(d) + '»'; }).join(', ') + ' — выберите для них другую группу или «Напрямую».') : '',
			uci.get(CONF, 'global', 'full_group') === sid ? awg.banner('warn', 'Это группа «для всего остального»',
				'Выберите другую в разделе «Куда идёт всё остальное».') : '',
			E('div', { 'class': 'awg-btns', 'style': 'justify-content:flex-end' }, [
				E('button', { 'class': 'btn', 'type': 'button', 'click': ui.hideModal }, txt('Отмена')),
				E('button', { 'class': 'btn cbi-button-negative', 'type': 'button', 'click': function() {
					lists.forEach(function(d) { uci.unset(CONF, d['.name'], 'group'); });
					if (uci.get(CONF, 'global', 'full_group') === sid) uci.unset(CONF, 'global', 'full_group');
					uci.remove(CONF, sid);
					ui.hideModal();
					self.changed();
					self.draw();
				} }, txt('Удалить'))
			])
		]);
	},

	setMembers: function(sid, m) {
		awg.setOpt(sid, 'tunnel', m);
		var act = uci.get(CONF, sid, 'active');
		if (act && m.indexOf(act) < 0) uci.unset(CONF, sid, 'active');
		this.changed();
		this.draw();
	},

	membersBlock: function(g) {
		var self = this, sid = g['.name'];
		var m = awg.list(g.tunnel);
		var tmap = {};
		tunnels().forEach(function(t) { tmap[t['.name']] = t; });

		var rows = m.map(function(name, i) {
			var t = tmap[name];
			function mv(d) { var c = m.slice(); var x = c[i]; c[i] = c[i + d]; c[i + d] = x; self.setMembers(sid, c); }
			return E('div', { 'class': 'awg-member' }, [
				E('span', { 'class': 'awg-num' }, txt(i + 1)),
				E('div', { 'class': 'awg-grow' }, [
					E('strong', {}, txt(t ? awg.sectionLabel(t) : name)),
					E('span', { 'class': 'awg-muted awg-small' }, txt(' — ' + (i === 0 ? 'основной' : 'запасной ' + i) +
						(!t ? ' · туннель не найден' : t.enabled === '0' ? ' · выключен' : '') + (t && t.interface ? ' · ' + t.interface : '')))
				]),
				E('div', { 'class': 'awg-btns' }, [
					E('button', { 'type': 'button', 'class': 'btn cbi-button-neutral', 'disabled': i === 0 ? '' : null,
						'title': 'Выше (важнее)', 'aria-label': 'Поднять «' + (t ? awg.sectionLabel(t) : name) + '» выше', 'click': function() { mv(-1); } }, txt('▲')),
					E('button', { 'type': 'button', 'class': 'btn cbi-button-neutral', 'disabled': i === m.length - 1 ? '' : null,
						'title': 'Ниже', 'aria-label': 'Опустить «' + (t ? awg.sectionLabel(t) : name) + '» ниже', 'click': function() { mv(1); } }, txt('▼')),
					E('button', { 'type': 'button', 'class': 'btn cbi-button-negative', 'title': 'Убрать из группы',
						'aria-label': 'Убрать «' + (t ? awg.sectionLabel(t) : name) + '» из группы',
						'click': function() { self.setMembers(sid, m.filter(function(x, j) { return j !== i; })); } }, txt('✕'))
				])
			]);
		});

		var avail = tunnels().filter(function(t) { return m.indexOf(t['.name']) < 0; });
		var canAdd = avail.length && m.length < awg.MAX_MEMBERS;
		var sel = awg.select(avail.map(function(t) {
			return [ t['.name'], awg.sectionLabel(t) + (t.enabled === '0' ? ' (выключен)' : '') ];
		}), '', { 'disabled': canAdd ? null : '', 'aria-label': 'Туннель для добавления в группу' });

		return E('div', { 'class': 'awg-field' }, [
			E('label', {}, txt('Туннели группы — по приоритету')),
			awg.muted('№1 — основной: пока он работает, весь трафик группы идёт через него. Если он перестанет отвечать, группа ' +
				'перейдёт на №2, затем на №3 и так далее. Стрелками ▲▼ меняйте порядок.', 'div'),
			rows.length ? E('div', {}, rows) : awg.banner('warn', 'В группе нет туннелей', 'Добавьте хотя бы один — иначе её сайты не пойдут через VPN.'),
			E('div', { 'class': 'awg-btns' }, [
				sel,
				E('button', { 'type': 'button', 'class': 'btn cbi-button-add', 'disabled': canAdd ? null : '',
					'click': function() { if (sel.value) self.setMembers(sid, m.concat([ sel.value ])); } }, txt('+ Добавить туннель в группу')),
				!tunnels().length ? E('a', { 'href': L.url('admin/services/awgsplit/tunnels') }, txt('Сначала добавьте туннель на вкладке «Туннели»')) :
				!avail.length ? E('span', { 'class': 'awg-muted awg-small' }, txt('Все туннели уже в группе.')) :
				m.length >= awg.MAX_MEMBERS ? E('span', { 'class': 'awg-muted awg-small' }, txt('В группе максимум ' + awg.MAX_MEMBERS + ' туннелей.')) : ''
			])
		]);
	},

	failbackBlock: function(g) {
		var self = this, sid = g['.name'];
		var fb = g.failback === 'manual' ? 'manual' : 'auto';
		var delay = E('input', { 'type': 'number', 'min': '10', 'max': '86400', 'class': 'cbi-input-text', 'style': 'width:8em',
			'value': g.failback_delay || '', 'placeholder': '120', 'aria-label': 'Через сколько секунд возвращаться' });
		var dErr = awg.bindField(this.checks, delay, {
			name: 'Группа «' + awg.sectionLabel(g) + '», возврат на основной',
			validate: function(v) { return (!v || (/^\d+$/.test(v) && +v >= 10 && +v <= 86400)) ? true : 'Число секунд от 10 до 86400'; },
			set: function(v) { awg.setOpt(sid, 'failback_delay', v.trim()); self.changed(); }
		});

		function radio(val, children) {
			var r = E('input', { 'type': 'radio', 'name': 'fb-' + sid, 'value': val, 'checked': fb === val ? '' : null });
			r.addEventListener('change', function() { if (r.checked) { uci.set(CONF, sid, 'failback', val); self.changed(); } });
			return E('label', { 'class': 'awg-check', 'style': 'margin:4px 0' }, [ r, E('span', {}, children) ]);
		}

		return E('div', { 'class': 'awg-field' }, [
			E('label', {}, txt('Когда основной туннель снова заработает')),
			radio('auto', [ E('span', {}, txt('Вернуться на него автоматически, когда он проработает без сбоев ')), delay, E('span', {}, txt(' секунд')) ]),
			dErr,
			radio('manual', [ E('span', {}, txt('Оставаться на запасном, пока тот работает. Вернуть можно кнопкой «Вернуться на основной» на «Обзоре».')) ])
		]);
	},

	communityBlock: function(g) {
		var self = this, sid = g['.name'];
		var chosen = awg.list(g.community_lists);
		var count = E('span', {}, txt(chosen.length));
		var boxes = awg.COMMUNITY.map(function(c) {
			return self.commCheckbox(sid, c, chosen.indexOf(c[0]) >= 0, function(on) {
				var cur = awg.list(uci.get(CONF, sid, 'community_lists')).filter(function(x) { return x !== c[0]; });
				if (on) cur.push(c[0]);
				awg.setOpt(sid, 'community_lists', cur);
				dom.content(count, txt(cur.length));
				self.changed();
				self.refreshCommunity();
			});
		});
		return this.details('g:' + sid + ':lists', [ E('span', {}, txt('Готовые списки сайтов (выбрано: ')), count, E('span', {}, txt(')')) ], [
			awg.muted('Обновляются автоматически. Список может быть только в одной группе — занятые другой группой показаны серым.', 'div'),
			E('div', { 'class': 'awg-checks' }, boxes)
		]);
	},

	commCheckbox: function(owner, c, checked, onchange) {
		var cb = E('input', { 'type': 'checkbox', 'checked': checked ? '' : null });
		var why = E('span', { 'class': 'awg-small' });
		cb.addEventListener('change', function() { onchange(cb.checked); });
		var wrap = E('label', { 'class': 'awg-check', 'title': c[0] }, [ cb, E('span', {}, [
			E('span', {}, txt(c[1])),
			c[2] ? E('span', { 'class': 'awg-muted awg-small' }, txt(' — ' + c[2])) : '',
			E('br'), why
		]) ]);
		this.commBoxes.push({ owner: owner, id: c[0], cb: cb, wrap: wrap, why: why });
		return wrap;
	},

	// серым — списки, уже занятые другой группой или исключениями
	refreshCommunity: function() {
		(this.commBoxes || []).forEach(function(b) {
			var other = owners(b.id).filter(function(o) { return o !== b.owner; });
			var block = other.length && !b.cb.checked;
			b.cb.disabled = !!block;
			b.wrap.classList.toggle('awg-dis', !!block);
			dom.content(b.why, other.length ? [ awg.badge(b.cb.checked ? 'bad' : 'off', (b.cb.checked ? '⚠ ещё и ' : 'уже ') + other.map(ownerName).join(', ')) ] : []);
		});
	},

	groupPanel: function(g) {
		var self = this, sid = g['.name'];
		var enabled = g.enabled !== '0';

		var label = E('input', { 'type': 'text', 'class': 'cbi-input-text', 'value': g.label || '', 'placeholder': 'например, США', 'maxlength': '40',
			'aria-label': 'Название группы' });
		var lErr = awg.bindField(this.checks, label, {
			set: function(v) { awg.setOpt(sid, 'label', v.trim()); self.changed(); }
		});

		var en = E('input', { 'type': 'checkbox', 'checked': enabled ? '' : null });
		en.addEventListener('change', function() { uci.set(CONF, sid, 'enabled', en.checked ? '1' : '0'); self.changed(); });

		var ks = awg.checkbox('Kill switch', g.killswitch !== '0', function(v) {
			uci.set(CONF, sid, 'killswitch', v ? '1' : '0'); self.changed();
		}, 'Если не работает ни один туннель группы, её сайты блокируются (рекомендуется). Если выключить — они откроются ' +
			'напрямую через провайдера, и провайдер увидит, куда вы ходите.');

		var subnets = E('textarea', { 'rows': '3', 'class': 'cbi-input-textarea', 'placeholder': '203.0.113.0/24\n198.51.100.7' },
			txt(awg.list(g.subnets).join('\n')));
		var sErr = awg.bindField(this.checks, subnets, {
			name: 'Группа «' + awg.sectionLabel(g) + '», подсети',
			validate: awg.validCidrText,
			set: function(v) { awg.setOpt(sid, 'subnets', awg.splitTokens(v)); self.changed(); }
		});

		var own = awg.sections('domains').filter(function(d) { return d.group === sid; });

		var adv = [ MARK, TABLE, PRIO ].map(function(k) {
			var inp = E('input', { 'type': 'text', 'class': 'cbi-input-text', 'value': g[k[0]] || '', 'placeholder': 'авто', 'style': 'width:9em' });
			var err = awg.bindField(self.checks, inp, {
				name: 'Группа «' + awg.sectionLabel(g) + '», ' + k[0],
				validate: function(v) {
					if (!v) return true;
					var n = k[1](v);
					if (isNaN(n) || (k[0] !== 'fwmark' && (n < (k[0] === 'priority' ? 91 : 1) || n > k[3])))
						return k[0] === 'fwmark' ? 'Число 0x1..0xffffffff' : k[0] === 'table' ? 'Целое 1..252' : 'Целое 91..32765';
					var clash = groups().filter(function(o) { return o['.name'] !== sid && k[1](o[k[0]]) === n; });
					return clash.length ? 'Уже занято группой «' + awg.sectionLabel(clash[0]) + '»' : true;
				},
				set: function(v) { awg.setOpt(sid, k[0], v.trim()); self.changed(); }
			});
			return awg.field({ fwmark: 'Метка пакетов', table: 'Таблица маршрутизации', priority: 'Приоритет правила' }[k[0]], inp, null, err);
		});

		return E('div', { 'class': 'awg-panel ' + (enabled ? 'awg-s-info' : '') }, [
			E('div', { 'class': 'awg-head' }, [
				E('div', { 'class': 'awg-title', 'style': 'flex:1 1 16em' }, [
					E('div', { 'style': 'flex:1 1 12em' }, [ label, lErr ]),
					E('label', { 'class': 'awg-check' }, [ en, E('span', {}, txt('Включена')) ])
				]),
				E('div', { 'class': 'awg-btns' }, [
					E('span', { 'class': 'awg-muted awg-small' }, txt('id: ' + sid)),
					E('button', { 'type': 'button', 'class': 'btn cbi-button-negative', 'click': function() { self.removeGroup(sid); } }, txt('✕ Удалить группу'))
				])
			]),
			this.membersBlock(g),
			this.failbackBlock(g),
			E('div', { 'class': 'awg-field' }, [ ks ]),
			this.communityBlock(g),
			this.details('g:' + sid + ':subnets', txt('Свои подсети и IP-адреса (' + awg.list(g.subnets).length + ')'), [
				awg.field('Подсети', subnets, 'По одной на строку, например 203.0.113.0/24. Идут в группу без участия DNS и главнее остальных правил.', sErr)
			]),
			own.length ? E('div', { 'class': 'awg-small', 'style': 'margin:6px 0' }, [
				E('strong', {}, txt('Свои списки: ')),
				E('span', {}, txt(own.map(function(d) { return '«' + awg.sectionLabel(d) + '»'; }).join(', ') + ' (ниже на этой странице)'))
			]) : '',
			this.details('g:' + sid + ':adv', txt('Дополнительно (для опытных)'), [
				awg.muted('Служебные номера для маршрутизации. Подбираются автоматически и должны быть разными у всех групп. ' +
					'Пусто — подставится свободный номер при сохранении.', 'div'),
				E('div', { 'class': 'awg-fields' }, adv)
			])
		]);
	},

	// ---------------------------------------------------------------- свои списки: «список → куда идёт»
	syncOrder: function() {
		var all = awg.sections('domains').concat(awg.sections('bypass')).map(function(s) { return s['.name']; });
		this.listOrder = this.listOrder.filter(function(x) { return all.indexOf(x) >= 0; });
		var self = this;
		all.forEach(function(x) { if (self.listOrder.indexOf(x) < 0) self.listOrder.push(x); });
		return this.listOrder;
	},

	// сменить тип секции (domains ⇄ bypass), сохранив название, флажок и домены
	convertList: function(sid, toGroup) {
		var s = uci.get(CONF, sid);
		var nn = awg.uniqueName(toGroup === DIRECT ? 'direct' : 'list');
		uci.add(CONF, toGroup === DIRECT ? 'bypass' : 'domains', nn);
		[ 'enabled', 'label', 'domains' ].forEach(function(k) { if (s[k] != null && s[k] !== '') uci.set(CONF, nn, k, s[k]); });
		if (toGroup !== DIRECT) uci.set(CONF, nn, 'group', toGroup);
		uci.remove(CONF, sid);
		var i = this.listOrder.indexOf(sid);
		if (i >= 0) this.listOrder[i] = nn;
		if (this.open['l:' + sid]) this.open['l:' + nn] = true;
		return nn;
	},

	listDest: function(s) {
		if (s['.type'] === 'bypass') return DIRECT;
		if (s.group) return s.group;
		// список из версии 1.x привязан к туннелю — если есть группа с тем же именем, показываем её
		if (s.tunnel && exists('group', s.tunnel)) return s.tunnel;
		return '';
	},

	listPanel: function(sid) {
		var self = this;
		var s = uci.get(CONF, sid);
		var dest = this.listDest(s);
		var isDirect = dest === DIRECT;
		var enabled = s.enabled !== '0';

		var en = E('input', { 'type': 'checkbox', 'checked': enabled ? '' : null });
		en.addEventListener('change', function() { uci.set(CONF, sid, 'enabled', en.checked ? '1' : '0'); self.changed(); });

		var label = E('input', { 'type': 'text', 'class': 'cbi-input-text', 'value': s.label || '', 'placeholder': 'например, Мои сайты', 'maxlength': '60',
			'aria-label': 'Название списка' });
		awg.bindField(this.checks, label, { set: function(v) { awg.setOpt(sid, 'label', v.trim()); self.changed(); } });

		var opts = [ [ '', '— выберите, куда направлять —' ] ].concat(groups().map(function(g) {
			return [ g['.name'], '→ через группу «' + awg.sectionLabel(g) + '»' ];
		}));
		if (dest && dest !== DIRECT && !exists('group', dest)) opts.push([ dest, dest + ' (группа не найдена)' ]);
		opts.push([ DIRECT, '⇢ Напрямую, не через VPN' ]);
		var sel = awg.select(opts, dest);
		var sErr = awg.bindField(this.checks, sel, {
			name: 'Список «' + (s.label || sid) + '»',
			validate: function(v) {
				if (!v) return s.tunnel ? 'Список из старой версии привязан к туннелю «' + s.tunnel + '» — выберите группу' : 'Выберите, куда направлять список';
				return (v === DIRECT || exists('group', v)) ? true : 'Такой группы нет — выберите другую';
			}
		});
		sel.addEventListener('change', function() {
			var v = sel.value;
			var cur = uci.get(CONF, sid);
			if (!v) return;
			if ((v === DIRECT) !== (cur['.type'] === 'bypass')) {
				self.convertList(sid, v);
			} else if (v !== DIRECT) {
				uci.set(CONF, sid, 'group', v);
				uci.unset(CONF, sid, 'tunnel');
			}
			self.changed();
			self.draw();
		});

		var ks = isDirect ? '' : awg.checkbox('Никогда не пускать мимо VPN', s.killswitch === '1', function(v) {
			awg.setOpt(sid, 'killswitch', v ? '1' : null); self.changed();
		}, 'Kill switch только для этого списка: если туннели группы не работают, эти сайты блокируются, даже если у группы kill switch выключен.');

		var count = E('span', {}, txt(awg.domainTokens(s.domains).length));
		var ta = E('textarea', { 'rows': '10', 'wrap': 'off', 'spellcheck': 'false', 'class': 'cbi-input-textarea',
			'placeholder': isDirect ? 'yandex.ru\nvk.com' : 'example.com\nanother.org' }, txt(s.domains || ''));
		var tErr = awg.bindField(this.checks, ta, {
			name: 'Список «' + (s.label || sid) + '»',
			validate: awg.validDomainsText,
			set: function(v) { awg.setOpt(sid, 'domains', v); dom.content(count, txt(awg.domainTokens(v).length)); self.changed(); }
		});

		return E('div', { 'class': 'awg-panel ' + (isDirect ? 'awg-s-ok' : dest ? 'awg-s-info' : 'awg-s-warn') }, [
			E('div', { 'class': 'awg-head' }, [
				E('div', { 'class': 'awg-title', 'style': 'flex:1 1 16em' }, [
					E('div', { 'style': 'flex:1 1 12em' }, [ label ]),
					E('label', { 'class': 'awg-check' }, [ en, E('span', {}, txt('Включён')) ])
				]),
				E('button', { 'type': 'button', 'class': 'btn cbi-button-negative', 'click': function() {
					if (!window.confirm('Удалить список «' + (uci.get(CONF, sid, 'label') || sid) + '»?')) return;
					uci.remove(CONF, sid); self.changed(); self.draw();
				} }, txt('✕ Удалить'))
			]),
			awg.field('Куда идут эти сайты', sel, null, sErr),
			ks ? E('div', { 'class': 'awg-field' }, [ ks ]) : '',
			this.details('l:' + sid, [ E('span', {}, txt('Сайты в списке: ')), count ], [
				awg.field('Домены', ta, 'Один на строку (можно через пробел или запятую), # — комментарий. Поддомены входят сами: ' +
					'example.com захватит и api.example.com.' + (isDirect ? ' Строка «ru» отправит напрямую всю зону .ru.' : ''), tErr)
			])
		]);
	},

	addList: function() {
		var g = groups()[0];
		var sid;
		if (g) {
			sid = awg.uniqueName('list');
			uci.add(CONF, 'domains', sid);
			uci.set(CONF, sid, 'group', g['.name']);
		} else {
			sid = awg.uniqueName('direct');
			uci.add(CONF, 'bypass', sid);
		}
		uci.set(CONF, sid, 'enabled', '1');
		uci.set(CONF, sid, 'label', 'Новый список');
		this.syncOrder();
		this.open['l:' + sid] = true;
		this.changed();
		this.draw();
	},

	listsCard: function() {
		var self = this;
		var order = this.syncOrder();
		return awg.card('Свои списки сайтов', [
			awg.muted('Для каждого списка выберите, куда идут его сайты: через одну из групп или «Напрямую». ' +
				'Более точный домен (api.example.com) всегда главнее общего (example.com).'),
			E('div', {}, order.map(function(sid) { return self.listPanel(sid); })),
			E('div', { 'class': 'awg-row' }, [
				E('button', { 'type': 'button', 'class': 'btn cbi-button-add', 'click': function() { self.addList(); } }, txt('+ Добавить список'))
			])
		]);
	},

	// ---------------------------------------------------------------- исключения
	bypassCard: function() {
		var self = this;
		var chosen = awg.list(uci.get(CONF, 'global', 'bypass_lists'));
		var boxes = awg.BYPASS_COMMUNITY.map(function(c) {
			return self.commCheckbox(BYPASS_OWNER, c, chosen.indexOf(c[0]) >= 0, function(on) {
				var cur = awg.list(uci.get(CONF, 'global', 'bypass_lists')).filter(function(x) { return x !== c[0]; });
				if (on) cur.push(c[0]);
				awg.setOpt('global', 'bypass_lists', cur);
				self.changed();
				self.refreshCommunity();
			});
		});

		var subnets = E('textarea', { 'rows': '3', 'class': 'cbi-input-textarea', 'placeholder': '203.0.113.0/24' },
			txt(awg.list(uci.get(CONF, 'global', 'bypass_subnets')).join('\n')));
		var sErr = awg.bindField(this.checks, subnets, {
			name: 'Подсети-исключения',
			validate: awg.validCidrText,
			set: function(v) { awg.setOpt('global', 'bypass_subnets', awg.splitTokens(v)); self.changed(); }
		});

		var mode = uci.get(CONF, 'global', 'mode') === 'full' ? 'full' : 'split';
		return awg.card('Исключения — всегда напрямую', [
			mode === 'split' ? awg.banner('info', 'Сейчас раздельный режим',
				'Всё, что не входит в списки групп, и так идёт напрямую — исключения нужны в основном для полного режима.') : '',
			awg.muted('Эти сайты никогда не идут через VPN и узнаются через DNS провайдера. Сюда же относятся ваши списки ' +
				'с направлением «Напрямую» (выше). Не добавляйте сюда «Россию внутри» — это заблокированные в РФ сайты, им нужен VPN.'),
			E('div', { 'class': 'awg-field' }, [ E('label', {}, txt('Готовые списки-исключения')), E('div', { 'class': 'awg-checks' }, boxes) ]),
			awg.field('Подсети-исключения', subnets, 'IPv4-адрес или подсеть, по одной на строку.', sErr)
		]);
	},

	// ---------------------------------------------------------------- проверки перед сохранением
	extraChecks: function() {
		var errs = [];
		var gl_ = groups(), tn = {};
		tunnels().forEach(function(t) { tn[t['.name']] = true; });
		if (gl_.length > awg.MAX_GROUPS) errs.push('Групп ' + gl_.length + ', а можно не больше ' + awg.MAX_GROUPS);
		gl_.forEach(function(g) {
			var m = awg.list(g.tunnel), name = '«' + awg.sectionLabel(g) + '»';
			if (g.enabled !== '0' && !m.length) errs.push('В группе ' + name + ' нет ни одного туннеля');
			if (m.length > awg.MAX_MEMBERS) errs.push('В группе ' + name + ' больше ' + awg.MAX_MEMBERS + ' туннелей');
			m.forEach(function(t) { if (!tn[t]) errs.push('В группе ' + name + ' указан несуществующий туннель «' + t + '»'); });
		});
		var seen = {};
		awg.COMMUNITY.concat(awg.BYPASS_COMMUNITY).forEach(function(c) {
			if (seen[c[0]]) return;
			seen[c[0]] = true;
			var o = owners(c[0]);
			if (o.length > 1) errs.push('Готовый список «' + c[1] + '» выбран в нескольких местах: ' + o.map(ownerName).join(', ') + '. Оставьте одно.');
		});
		if (uci.get(CONF, 'global', 'mode') === 'full') {
			var fg = uci.get(CONF, 'global', 'full_group');
			if (!fg || !exists('group', fg)) errs.push('Полный режим: выберите группу для «всего остального»');
		}
		return errs;
	},

	beforeSave: function() {
		groups().forEach(function(g) { fillAuto(g['.name']); });
		// списки из 1.x: привязка к туннелю превращается в привязку к группе с тем же именем
		awg.sections('domains').forEach(function(d) {
			if (!d.group && d.tunnel && exists('group', d.tunnel)) {
				uci.set(CONF, d['.name'], 'group', d.tunnel);
				uci.unset(CONF, d['.name'], 'tunnel');
			}
		});
	}
}, awg.saveHandlers('draw')));
