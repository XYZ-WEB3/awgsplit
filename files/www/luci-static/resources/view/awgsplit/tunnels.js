'use strict';
'require view';
'require ui';
'require uci';
'require dom';
'require poll';
'require view.awgsplit.common as awg';

var txt = awg.txt;
var CONF = awg.CONF;
var RE_IFACE = /^[A-Za-z][A-Za-z0-9_]{0,14}$/;
var RESERVED = { lan: 1, wan: 1, wan6: 1, loopback: 1, lo: 1, globals: 1, awgsplit: 1 };

function tunnels() { return awg.sections('tunnel'); }

function groupsUsing(name) {
	var out = [];
	awg.sections('group').forEach(function(g) {
		var m = awg.list(g.tunnel), i = m.indexOf(name);
		if (i >= 0) out.push({ group: g, index: i });
	});
	return out;
}

return view.extend(Object.assign({
	load: function() {
		return Promise.all([
			awg.callInterfaces().catch(function() { return []; }),
			awg.callStatus().catch(function() { return {}; }),
			uci.load(CONF)
		]);
	},

	render: function(data) {
		var self = this;
		this.ifaces = Array.isArray(data[0]) ? data[0] : [];
		this.status = data[1] || {};
		this.marker = awg.dirtyMarker();
		this.listBox = E('div');
		this.toolBox = E('div');
		this.stateNodes = {};

		var root = awg.page('Туннели', 'Туннель — это одно подключение к VPN-серверу (интерфейс AmneziaWG). Сам по себе туннель ничего ' +
			'не заворачивает: сайты направляются в группы (вкладка «Группы и списки»), а группа использует свои туннели по порядку.', [
			awg.card('Как добавить VPN-сервер', [
				E('ol', { 'class': 'awg-steps' }, [
					E('li', {}, txt('Нажмите «Импортировать .conf…» и загрузите файл из приложения AmneziaVPN (Поделиться → формат AmneziaWG).')),
					E('li', {}, txt('Туннель появится в списке ниже. Дайте ему понятное название, например «США #1».')),
					E('li', {}, txt('Нажмите «Сохранить и применить» внизу страницы.')),
					E('li', {}, txt('На вкладке «Группы и списки» добавьте туннель в группу — только тогда через него пойдут сайты.'))
				])
			]),
			this.marker.node,
			this.toolBox,
			this.listBox
		]);

		this.draw();
		poll.add(function() {
			return awg.callStatus().then(function(st) { if (st) { self.status = st; self.updateStates(); } }).catch(function() {});
		}, 10);
		return root;
	},

	changed: function() { this.marker.mark(); },

	liveState: function(name) {
		var list = Array.isArray(this.status.tunnels) ? this.status.tunnels : [];
		return list.filter(function(t) { return t.name === name; })[0] || null;
	},

	stateContent: function(name) {
		var enabled = uci.get(CONF, name, 'enabled') !== '0';
		var t = this.liveState(name);
		if (!enabled) return [ awg.tunnelBadge('off') ];
		if (!t) return [ awg.badge('off', '○ Ещё не применён'), E('div', { 'class': 'awg-muted awg-small' },
			txt('Состояние появится после «Сохранить и применить».')) ];
		return [ awg.tunnelBadge(t.state), E('div', { 'class': 'awg-muted awg-small' }, txt(awg.fmtHandshake(t.handshake_age))) ];
	},

	updateStates: function() {
		var self = this;
		Object.keys(this.stateNodes).forEach(function(name) {
			var node = self.stateNodes[name];
			var t = self.liveState(name);
			awg.patch(node, [ t && t.state, t && t.handshake_age, uci.get(CONF, name, 'enabled') ], function() { return self.stateContent(name); });
		});
	},

	ifaceOptions: function(current) {
		var opts = [ [ '', '— выберите интерфейс —' ] ], known = {};
		this.ifaces.forEach(function(i) {
			known[i.name] = true;
			opts.push([ i.name, i.name + ' (' + (i.proto || '?') + ')' ]);
		});
		tunnels().forEach(function(t) {
			if (t.interface && !known[t.interface]) {
				known[t.interface] = true;
				opts.push([ t.interface, t.interface + ' (интерфейса нет в сети — импортируйте .conf)' ]);
			}
		});
		return opts;
	},

	freeIface: function() {
		var used = {};
		tunnels().forEach(function(t) { if (t.interface) used[t.interface] = true; });
		var f = this.ifaces.filter(function(i) { return !used[i.name]; })[0];
		return f ? f.name : '';
	},

	addTunnel: function(iface, label) {
		if (tunnels().length >= awg.MAX_TUNNELS) return null;
		var name = awg.uniqueName('tun');
		uci.add(CONF, 'tunnel', name);
		uci.set(CONF, name, 'enabled', '1');
		if (label) uci.set(CONF, name, 'label', label);
		if (iface) uci.set(CONF, name, 'interface', iface);
		this.changed();
		this.draw();
		return name;
	},

	removeTunnel: function(name) {
		var self = this;
		var used = groupsUsing(name);
		var label = awg.sectionLabel(uci.get(CONF, name));
		ui.showModal('Удалить туннель «' + label + '»?', [
			E('p', {}, txt('Из настроек awgsplit удалится только запись о туннеле. Сам интерфейс AmneziaWG в «Сеть → Интерфейсы» останется.')),
			used.length ? awg.banner('warn', 'Туннель используется в группах',
				'Он будет убран из групп: ' + used.map(function(u) { return '«' + awg.sectionLabel(u.group) + '»'; }).join(', ') +
				'. Проверьте потом, что в каждой группе остался хотя бы один туннель.') : '',
			E('div', { 'class': 'right awg-btns', 'style': 'justify-content:flex-end' }, [
				E('button', { 'class': 'btn', 'type': 'button', 'click': ui.hideModal }, txt('Отмена')),
				E('button', { 'class': 'btn cbi-button-negative', 'type': 'button', 'click': function() {
					used.forEach(function(u) {
						var gid = u.group['.name'];
						awg.setOpt(gid, 'tunnel', awg.list(u.group.tunnel).filter(function(x) { return x !== name; }));
						if (uci.get(CONF, gid, 'active') === name) uci.unset(CONF, gid, 'active');
					});
					uci.remove(CONF, name);
					ui.hideModal();
					self.changed();
					self.draw();
				} }, txt('Удалить'))
			])
		]);
	},

	tunnelPanel: function(s) {
		var self = this, name = s['.name'];
		var enabled = s.enabled !== '0';

		var en = E('input', { 'type': 'checkbox', 'checked': enabled ? '' : null });
		en.addEventListener('change', function() {
			uci.set(CONF, name, 'enabled', en.checked ? '1' : '0');
			self.changed();
			self.updateStates();
		});

		var label = E('input', { 'type': 'text', 'class': 'cbi-input-text', 'value': s.label || '', 'placeholder': 'например, США #1', 'maxlength': '40' });
		var lErr = awg.bindField(this.checks, label, {
			set: function(v) { awg.setOpt(name, 'label', v.trim()); self.changed(); }
		});

		var iface = awg.select(this.ifaceOptions(), s.interface || '');
		var iErr = awg.bindField(this.checks, iface, {
			name: 'Туннель «' + (s.label || name) + '»',
			validate: function(v) {
				if (!v) return 'Выберите интерфейс (сначала импортируйте .conf)';
				var clash = tunnels().filter(function(t) { return t['.name'] !== name && t.interface === v; });
				return clash.length ? 'Этот интерфейс уже занят туннелем «' + awg.sectionLabel(clash[0]) + '»' : true;
			},
			set: function(v) { awg.setOpt(name, 'interface', v); self.changed(); },
			after: function() { awg.runChecks(self.checks); }
		});

		var dns = E('input', { 'type': 'text', 'class': 'cbi-input-text', 'value': awg.list(s.dns).join(', '), 'placeholder': 'из .conf (обычно 172.29.172.254)' });
		var dErr = awg.bindField(this.checks, dns, {
			name: 'DNS туннеля «' + (s.label || name) + '»',
			validate: awg.validIp4Text,
			set: function(v) { awg.setOpt(name, 'dns', awg.splitTokens(v)); self.changed(); }
		});

		var stateNode = E('div');
		this.stateNodes[name] = stateNode;
		dom.content(stateNode, this.stateContent(name));

		var used = groupsUsing(name);
		var usage = used.length ?
			E('div', { 'class': 'awg-small' }, [ E('strong', {}, txt('В группах: ')), E('span', {}, txt(used.map(function(u) {
				return '«' + awg.sectionLabel(u.group) + '» (' + (u.index === 0 ? 'основной' : 'запасной ' + u.index) + ')';
			}).join(', '))) ]) :
			E('div', { 'class': 'awg-small' }, [ awg.badge('warn', '⚠ Не входит ни в одну группу'),
				E('span', {}, txt(' — через него ничего не пойдёт. Добавьте его в группу на вкладке ')),
				E('a', { 'href': L.url('admin/services/awgsplit/groups') }, txt('«Группы и списки»')) ]);

		return E('div', { 'class': 'awg-panel ' + (enabled ? 'awg-s-info' : '') }, [
			E('div', { 'class': 'awg-head' }, [
				E('div', { 'class': 'awg-title' }, [
					E('label', { 'class': 'awg-check' }, [ en, E('strong', {}, txt('Включён')) ]),
					stateNode
				]),
				E('div', { 'class': 'awg-btns' }, [
					E('span', { 'class': 'awg-muted awg-small' }, txt('id: ' + name)),
					E('button', { 'class': 'btn cbi-button-negative', 'type': 'button', 'click': function() { self.removeTunnel(name); } }, txt('✕ Удалить'))
				])
			]),
			E('div', { 'class': 'awg-fields' }, [
				awg.field('Название', label, 'Как туннель будет называться в группах и на «Обзоре».', lErr),
				awg.field('Интерфейс AmneziaWG', iface, 'Создаётся импортом .conf. У каждого туннеля свой.', iErr),
				awg.field('DNS туннеля (необязательно)', dns,
					'Через него внутри туннеля узнаются адреса сайтов группы. Пусто — берётся DNS из .conf.', dErr)
			]),
			usage
		]);
	},

	draw: function() {
		var self = this;
		this.checks = [];
		this.stateNodes = {};
		var list = tunnels();
		var full = list.length >= awg.MAX_TUNNELS;

		dom.content(this.toolBox, E('div', { 'class': 'awg-row', 'style': 'margin-bottom:12px' }, [
			awg.button('⇪ Импортировать .conf…', 'cbi-button-action', function() { self.importDialog(); }),
			E('button', {
				'type': 'button', 'class': 'btn cbi-button-add',
				'disabled': full ? '' : null,
				'title': full ? 'Не больше ' + awg.MAX_TUNNELS + ' туннелей' : null,
				'click': function() { self.addTunnel(self.freeIface(), ''); }
			}, txt('+ Добавить туннель вручную')),
			E('span', { 'class': 'awg-count' }, txt('Туннелей: ' + list.length + ' из ' + awg.MAX_TUNNELS)),
			full ? E('span', { 'class': 'awg-muted awg-small' }, txt('Достигнут максимум — удалите ненужный туннель, чтобы добавить новый.')) : ''
		]));

		dom.content(this.listBox, list.length ? list.map(function(s) { return self.tunnelPanel(s); }) :
			[ awg.card(null, [ E('p', {}, txt('Туннелей пока нет. Нажмите «Импортировать .conf…» — это самый простой способ.')) ]) ]);
		// ошибки показываем сразу, чтобы конфликт интерфейсов был виден при открытии страницы
		awg.runChecks(this.checks);
	},

	extraChecks: function() {
		var n = tunnels().length;
		return n > awg.MAX_TUNNELS ? [ 'Туннелей ' + n + ', а можно не больше ' + awg.MAX_TUNNELS ] : [];
	},

	// ---------------------------------------------------------------- импорт .conf прямо отсюда
	importDialog: function() {
		var self = this;
		var used = {};
		this.ifaces.forEach(function(i) { used[i.name] = true; });
		tunnels().forEach(function(t) { if (t.interface) used[t.interface] = true; });
		var sug = 'awg_main';
		for (var i = 1; used[sug]; i++) sug = 'awg_' + i;

		var name = E('input', { 'type': 'text', 'class': 'cbi-input-text', 'value': sug, 'maxlength': '15' });
		var label = E('input', { 'type': 'text', 'class': 'cbi-input-text', 'placeholder': 'например, США #1', 'maxlength': '40' });
		var conf = E('textarea', { 'class': 'cbi-input-textarea', 'rows': '12', 'wrap': 'off', 'spellcheck': 'false',
			'placeholder': '[Interface]\nAddress = 10.8.0.2/32\nPrivateKey = ...\n\n[Peer]\nPublicKey = ...\nEndpoint = 1.2.3.4:35574' });
		var file = E('input', { 'type': 'file', 'accept': '.conf,.txt,text/plain' });
		file.addEventListener('change', function() {
			var f = file.files && file.files[0];
			if (!f) return;
			if (f.size > 65536) { awg.note('Файл слишком большой — это точно .conf?', 'danger'); return; }
			var r = new FileReader();
			r.onload = function() {
				conf.value = String(r.result || '');
				if (!label.value) label.value = f.name.replace(/\.[^.]*$/, '').slice(0, 40);
			};
			r.readAsText(f);
		});

		ui.showModal('Импорт конфига AmneziaVPN', [
			awg.field('Файл .conf', file, 'Или вставьте текст файла целиком в поле ниже.'),
			awg.field('Текст .conf', conf),
			E('div', { 'class': 'awg-fields' }, [
				awg.field('Название туннеля', label, 'Для вас: «США #1», «Казахстан».'),
				awg.field('Имя интерфейса', name, 'Латиница, цифры и _, с буквы, до 15 символов. Повторный импорт с тем же именем обновит настройки.')
			]),
			awg.muted('Поддерживаются все поля AmneziaWG 1.x–3.x. Всё проверяется до записи — при ошибке настройки роутера не меняются. ' +
				'AllowedIPs из файла не уводит весь трафик в туннель: маршрутами управляет awgsplit.'),
			E('div', { 'class': 'awg-btns', 'style': 'justify-content:flex-end' }, [
				E('button', { 'class': 'btn', 'type': 'button', 'click': ui.hideModal }, txt('Отмена')),
				E('button', { 'class': 'btn cbi-button-action', 'type': 'button', 'click': ui.createHandlerFn(null, function() {
					return self.doImport(name.value.trim(), conf.value, label.value.trim());
				}) }, txt('Импортировать'))
			])
		]);
	},

	doImport: function(name, conf, label) {
		var self = this;
		if (!RE_IFACE.test(name) || RESERVED[name]) {
			awg.note('Имя интерфейса: латиница, цифры и _, с буквы, до 15 символов, не lan/wan (например awg_main).', 'danger');
			return;
		}
		if (!/\[Interface\]/i.test(conf) || !/\[Peer\]/i.test(conf)) {
			awg.note('Нужен .conf целиком — с секциями [Interface] и [Peer].', 'danger');
			return;
		}
		ui.showModal('Импорт', [ E('p', { 'class': 'spinning' }, txt('Разбираю конфиг и создаю интерфейс…')) ]);
		return awg.callImport(conf, name).then(function(res) {
			var ok = (res && res.code === 0);
			return awg.callInterfaces().catch(function() { return self.ifaces; }).then(function(ifs) {
				if (Array.isArray(ifs)) self.ifaces = ifs;
				var added = null, existing = tunnels().filter(function(t) { return t.interface === name; })[0];
				if (ok && !existing) added = self.addTunnel(name, label || name);
				if (ok && existing && label && !existing.label) { uci.set(CONF, existing['.name'], 'label', label); self.changed(); }
				self.draw();
				ui.showModal(ok ? '✔ Готово' : 'Ошибка импорта', [
					ok ? awg.banner('ok', added ? 'Туннель «' + (label || name) + '» добавлен в список' :
						existing ? 'Интерфейс обновлён, туннель «' + awg.sectionLabel(existing) + '» уже есть' :
						'Интерфейс создан, но туннелей уже ' + awg.MAX_TUNNELS + ' — новый не добавлен', [
						E('span', {}, txt('Дальше: нажмите «Сохранить и применить» внизу страницы, затем добавьте туннель в группу на вкладке «Группы и списки».'))
					]) : '',
					E('pre', { 'class': 'awg-pre' }, txt(res && res.output ? res.output : 'Нет вывода')),
					E('div', { 'class': 'awg-btns', 'style': 'justify-content:flex-end' }, [
						E('button', { 'class': 'btn', 'type': 'button', 'click': ui.hideModal }, txt('Закрыть'))
					])
				]);
			});
		}).catch(function(e) {
			ui.hideModal();
			awg.rpcError(e);
		});
	}
}, awg.saveHandlers('draw')));
