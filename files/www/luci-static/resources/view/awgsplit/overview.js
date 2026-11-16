'use strict';
'require view';
'require ui';
'require poll';
'require dom';
'require view.awgsplit.common as awg';

var txt = awg.txt;
var UPLOAD_PATH = '/tmp/awgsplit-page.upload';

var GSTATE = {
	ok:       [ 'ok',   '✔ Всё в порядке',      'awg-s-ok' ],
	degraded: [ 'warn', '⚠ Работает на запасном', 'awg-s-warn' ],
	down:     [ 'bad',  '✕ Нет связи',          'awg-s-bad' ]
};

function tunnelMap(st) {
	var m = {};
	(Array.isArray(st.tunnels) ? st.tunnels : []).forEach(function(t) { if (t && t.name) m[t.name] = t; });
	return m;
}

function tLabel(tm, name) {
	if (!name) return '—';
	return tm[name] ? (tm[name].label || name) : name;
}

function groupLabel(st, name) {
	var g = (st.groups || []).filter(function(x) { return x.name === name; })[0];
	return g ? (g.label || g.name) : (name || '');
}

function nonEmpty(v) { return v != null && String(v).trim() !== ''; }

// ---------------------------------------------------------------- карточка группы
function groupInfo(g, tm) {
	var members = Array.isArray(g.members) ? g.members : [];
	var gs = GSTATE[g.state] || [ 'off', '○ ' + (g.state || 'нет данных'), '' ];
	var nodes = [];

	nodes.push(E('div', { 'class': 'awg-head' }, [
		E('div', { 'class': 'awg-title' }, [ E('h4', {}, txt(g.label || g.name)), awg.badge(gs[0], gs[1]) ]),
		E('span', { 'class': 'awg-muted awg-small' }, txt('группа ' + g.name))
	]));

	if (g.route === 'blocked')
		nodes.push(awg.banner('bad', 'Трафик группы заблокирован',
			'Ни один туннель группы сейчас не работает. Включён kill switch, поэтому сайты этой группы не открываются, ' +
			'чтобы не пойти мимо VPN. Как только любой туннель поднимется, всё заработает само.'));
	else if (g.route === 'direct')
		nodes.push(awg.banner('bad', 'Трафик группы идёт напрямую, мимо VPN',
			'Ни один туннель группы сейчас не работает, а kill switch выключен — сайты группы открываются через провайдера.'));
	else if (g.state === 'degraded')
		nodes.push(awg.banner('warn', 'Работает запасной туннель',
			'Основной туннель «' + tLabel(tm, members[0]) + '» сейчас не используется. Сайты группы открываются через «' +
			tLabel(tm, g.active) + '».'));

	nodes.push(E('div', {}, [
		E('strong', {}, txt('Сейчас через: ')),
		g.route === 'tunnel' && g.active ? E('span', {}, txt('«' + tLabel(tm, g.active) + '»')) :
			E('span', {}, txt(g.route === 'blocked' ? 'никуда (заблокировано)' : g.route === 'direct' ? 'напрямую через провайдера' : '—'))
	]));

	// цепочка туннелей по приоритету
	var chain = [];
	members.forEach(function(name, i) {
		var t = tm[name];
		var state = t ? (t.enabled === false || t.enabled === '0' ? 'off' : t.state) : 'unknown';
		var isActive = (name === g.active && g.route === 'tunnel');
		if (i) chain.push(E('span', { 'class': 'awg-arrow', 'aria-hidden': 'true' }, txt('→')));
		chain.push(E('div', { 'class': 'awg-chip' + (isActive ? ' awg-active' : '') }, [
			E('div', { 'class': 'awg-row', 'style': 'margin:0' }, [
				E('span', { 'class': 'awg-num', 'title': 'Приоритет ' + (i + 1) }, txt(i + 1)),
				E('strong', {}, txt(t ? (t.label || name) : name + ' (не найден)'))
			]),
			E('div', {}, [ awg.tunnelBadge(state) ]),
			E('div', { 'class': 'awg-muted awg-small' }, txt(i === 0 ? 'основной' : 'запасной ' + i)),
			E('div', { 'class': 'awg-muted awg-small' }, txt(t ? awg.fmtHandshake(t.handshake_age) : '')),
			isActive ? E('div', { 'class': 'awg-small' }, [ awg.badge('info', '▶ сейчас активен') ]) : '',
			name === g.pinned ? E('div', { 'class': 'awg-small' }, [ awg.badge('off', '📌 закреплён вручную') ]) : ''
		]));
	});
	nodes.push(chain.length ? E('div', { 'class': 'awg-chain', 'aria-label': 'Туннели группы по приоритету' }, chain) :
		awg.banner('warn', 'В группе нет туннелей', 'Добавьте туннели на вкладке «Группы и списки».'));

	// пояснения про ручное закрепление и возврат на основной
	if (nonEmpty(g.pinned))
		nodes.push(awg.muted('Туннель «' + tLabel(tm, g.pinned) + '» закреплён вручную: пока он работает, группа использует его. ' +
			'Если он упадёт — группа перейдёт на следующий по приоритету. Чтобы вернуть обычный порядок, нажмите «Вернуться на основной».'));
	else if (g.state === 'degraded' && members.length > 1) {
		if (g.failback === 'manual')
			nodes.push(awg.muted('Возврат на основной — вручную: когда «' + tLabel(tm, members[0]) +
				'» снова заработает, нажмите «Вернуться на основной».'));
		else if (+g.failback_in >= 0)
			nodes.push(E('p', {}, [ awg.badge('info', '⏱ ' + awg.fmtDur(g.failback_in)),
				E('span', {}, txt(' — через столько группа сама вернётся на «' + tLabel(tm, members[0]) + '» (он снова работает и проверяется на стабильность).')) ]));
		else
			nodes.push(awg.muted('Группа сама вернётся на «' + tLabel(tm, members[0]) +
				'», когда он восстановится и проработает без сбоев заданное время.'));
	}

	nodes.push(E('div', { 'class': 'awg-muted awg-small' }, txt(
		'Доменов: ' + (g.domains || 0) + ' · IP из DNS: ' + (g.ips || 0) + ' · подсетей: ' + (g.subnets || 0) +
		' · kill switch: ' + (g.killswitch ? 'вкл' : 'выкл'))));
	if (nonEmpty(g.missing_lists))
		nodes.push(E('div', { 'class': 'awg-banner awg-banner-warn awg-small', 'style': 'overflow-wrap:anywhere' }, txt('⚠ Не скачались списки: ' + g.missing_lists + '. Роутер докачает их сам; проверьте интернет на роутере.')));

	return nodes;
}

function groupControls(view, g, tm) {
	var members = Array.isArray(g.members) ? g.members : [];
	if (!members.length) return [];
	var sel = awg.select([ [ '', 'Переключить на…' ] ].concat(members.map(function(m, i) {
		return [ m, (i + 1) + '. ' + tLabel(tm, m) + (m === g.active ? ' (сейчас)' : '') ];
	})), '', { 'aria-label': 'Выбрать туннель для группы ' + (g.label || g.name) });
	var atPrimary = !nonEmpty(g.pinned) && g.active === members[0];

	return [
		E('div', { 'class': 'awg-btns' }, [
			sel,
			awg.button('Переключить', 'cbi-button-action', function() {
				if (!sel.value) { awg.note('Выберите туннель в списке «Переключить на…».', 'warning'); return; }
				return view.setActive(g, sel.value, tLabel(tm, sel.value));
			}),
			awg.button('↩ Вернуться на основной', 'cbi-button-neutral', function() {
				return view.setActive(g, '', tLabel(tm, members[0]));
			}, { 'disabled': atPrimary ? '' : null, 'title': atPrimary ? 'Группа уже работает через основной туннель' : null })
		])
	];
}

// ---------------------------------------------------------------- схема «как это работает»
function schema(st) {
	var groups = Array.isArray(st.groups) ? st.groups : [];
	var tm = tunnelMap(st);
	var rows = [];
	function row(src, dst, cls) {
		rows.push(E('div', { 'class': 'awg-flow-row' }, [
			E('span', { 'class': 'awg-box' }, txt(src)),
			E('span', { 'class': 'awg-arrow', 'aria-hidden': 'true' }, txt('→')),
			E('span', { 'class': 'awg-box ' + (cls || '') }, Array.isArray(dst) ? dst : txt(dst))
		]));
	}
	row('⌂ Внутренние адреса (192.168.x.x, 10.x …)', 'напрямую', 'awg-box-ok');
	row('⛨ Исключения и списки «Напрямую»', 'напрямую через провайдера', 'awg-box-ok');
	if (groups.length)
		groups.forEach(function(g) {
			var m = (g.members || []).map(function(n) { return tLabel(tm, n); });
			row('Списки группы «' + (g.label || g.name) + '»', m.length ? m.join(' › ') : 'нет туннелей', 'awg-box-info');
		});
	else
		row('Списки группы «Пример»', 'Туннель 1 › Туннель 2', 'awg-box-info awg-box-off');
	if (st.mode === 'full')
		row('Всё остальное', 'группа «' + groupLabel(st, st.full_group) + '»', 'awg-box-info');
	else
		row('Всё остальное', 'напрямую через провайдера', 'awg-box-ok');

	return E('div', { 'class': 'awg-flow', 'aria-label': 'Схема: куда идёт трафик' }, [
		E('div', { 'class': 'awg-flow-src' }, [
			E('span', { 'class': 'awg-box' }, txt('Устройства в сети')),
			E('span', { 'class': 'awg-arrow', 'aria-hidden': 'true' }, txt('→')),
			E('span', { 'class': 'awg-box' }, txt('Роутер проверяет адрес')),
			E('span', { 'class': 'awg-arrow', 'aria-hidden': 'true' }, txt('→'))
		]),
		E('div', { 'class': 'awg-flow-dst' }, rows)
	]);
}

function helpCard(schemaBox) {
	return awg.card('Как это работает', [
		schemaBox,
		E('ul', { 'class': 'awg-steps', 'style': 'margin-top:1em' }, [
			E('li', {}, [ E('strong', {}, txt('Туннель')), E('span', {}, txt(' — одно подключение к VPN-серверу (импортированный .conf).')) ]),
			E('li', {}, [ E('strong', {}, txt('Группа')), E('span', {}, txt(' — «направление»: набор списков сайтов и цепочка туннелей для них. ' +
				'Каждый список принадлежит ровно одной группе или идёт напрямую.')) ]),
			E('li', {}, [ E('strong', {}, txt('Порядок туннелей = приоритет.')), E('span', {}, txt(' Первый — основной. Если он перестал отвечать, ' +
				'группа сама переходит на второй, потом на третий… Вернуться на основной она может сама (через заданное время стабильной работы) ' +
				'или по вашей кнопке — это настраивается у группы.')) ]),
			E('li', {}, [ E('strong', {}, txt('Kill switch.')), E('span', {}, txt(' Если не работает ни один туннель группы: включён — сайты группы ' +
				'не открываются (ничего не утекает мимо VPN); выключен — открываются напрямую через провайдера.')) ]),
			E('li', {}, [ E('strong', {}, txt('Режимы.')), E('span', {}, txt(' «Раздельный»: через VPN идут только списки групп, остальное напрямую. ' +
				'«Полный»: через выбранную группу идёт всё, кроме исключений (российские сервисы и ваши списки «Напрямую»).')) ])
		]),
		awg.muted('«IP из DNS» растёт по мере того, как устройства открывают сайты. Если там 0 — устройства ещё не обращались ' +
			'к доменам из списков или их DNS идёт мимо роутера (DoH в браузере, свой DNS в настройках устройства).')
	]);
}

// ---------------------------------------------------------------- страница «ВПН упал»
function pageCard() {
	var box = E('div', {}, [ E('p', { 'class': 'spinning' }, txt('Загружаю список страниц…')) ]);

	function reload() { return awg.callPages().then(function(nr) { dom.content(box, build(nr || {})); }); }

	function build(r) {
		var pages = Array.isArray(r.pages) ? r.pages : [];
		var cur = r.current || '/awgsplit-down.html';
		var sel = awg.select(pages.map(function(p) { return [ p.path, p.title ]; }), cur, { 'style': 'min-width:16em', 'aria-label': 'Страница' });
		var preview = E('a', { 'href': cur, 'target': '_blank', 'rel': 'noreferrer' }, txt('Открыть для просмотра ↗'));
		sel.addEventListener('change', function() { preview.setAttribute('href', sel.value); });

		return [
			E('div', { 'class': 'awg-btns' }, [
				sel,
				awg.button('Применить', 'cbi-button-action', function() {
					return awg.callSetPage(sel.value).then(function(res) {
						if (res && res.error) throw new Error(res.error);
						awg.note('Страница выбрана. Веб-сервер перечитает настройки через пару секунд.');
						return reload();
					}).catch(awg.rpcError);
				}),
				preview
			]),
			E('div', { 'class': 'awg-btns', 'style': 'margin-top:8px' }, [
				awg.button('Загрузить свой HTML…', 'cbi-button-neutral', function() {
					return ui.uploadFile(UPLOAD_PATH).then(function(f) {
						return awg.callUploadPage(f.name).then(function(res) {
							if (res && res.error) throw new Error(res.error);
							awg.note('Файл загружен: ' + res.path + '. Выберите его в списке и нажмите «Применить».');
							return reload();
						});
					}).catch(awg.rpcError);
				}),
				E('span', { 'class': 'awg-muted awg-small' }, txt('до 1 МБ, имя латиницей, расширение .html'))
			]),
			E('details', {}, [
				E('summary', {}, txt('Как сделать свою страницу')),
				awg.muted('Это обычный HTML-файл: любой дизайн, картинки (data: URI внутри файла) и скрипты. Чтобы знать, жив ли VPN, ' +
					'страница может запросить /cgi-bin/awgsplit-state (открыт без входа, секретов в нём нет) и получить JSON со ' +
					'state: up — всё работает, down — что-то идёт напрямую или заблокировано, off — служба выключена. ' +
					'Готовый пример — example.html в списке: скопируйте, измените и загрузите.')
			])
		];
	}

	reload().catch(function() { dom.content(box, awg.muted('Не удалось получить список страниц.')); });

	return awg.card('Страница «ВПН упал»', [
		E('p', {}, txt('Когда VPN недоступен, роутер сам показывает на телефонах и компьютерах страницу с предупреждением ' +
			'(система откроет её как окно входа в сеть, один раз за разрыв). Когда связь вернётся, встроенная страница сама ' +
			'вернёт на прошлый сайт. Включить или выключить — на вкладке «Настройки».')),
		box
	]);
}

// ---------------------------------------------------------------- страница
return view.extend({
	load: function() {
		return awg.callStatus().catch(function() { return null; });
	},

	refresh: function() {
		var self = this;
		return awg.callStatus().then(function(st) { if (st) self.update(st); }).catch(function() {});
	},

	refreshSoon: function() {
		var self = this;
		[ 2500, 7000 ].forEach(function(ms) { window.setTimeout(function() { self.refresh(); }, ms); });
	},

	setActive: function(g, tunnel, label) {
		var self = this;
		return awg.callSetActive(g.name, tunnel).then(function(r) {
			if (r && r.error) throw new Error(r.error);
			awg.note(tunnel ? 'Группа «' + (g.label || g.name) + '» переключается на «' + label + '». Это займёт несколько секунд.' :
				'Группа «' + (g.label || g.name) + '» возвращается к обычному порядку: основной — «' + label + '».');
			self.refreshSoon();
		}).catch(awg.rpcError);
	},

	setDefault: function(mode, group, what) {
		var self = this;
		return awg.callSetDefault(mode, group).then(function(r) {
			if (r && r.error) throw new Error(r.error);
			awg.note(what + ' Применение займёт несколько секунд, открытые соединения переподключатся сами.');
			self.refreshSoon();
		}).catch(awg.rpcError);
	},

	// ---- верхние предупреждения
	buildBanners: function(st) {
		var out = [];
		if (!st.__ok)
			return [ awg.banner('bad', 'Не удалось получить состояние службы',
				'Роутер не ответил на запрос. Проверьте, что пакет awgsplit установлен, и обновите страницу.') ];
		if (!Array.isArray(st.groups))
			out.push(awg.banner('warn', 'Обновите службу awgsplit',
				'Этот веб-интерфейс рассчитан на группы туннелей, а служба на роутере старой версии и о группах не знает. ' +
				'Обновите пакет awgsplit (Система → Программное обеспечение или install.sh) и обновите страницу. ' +
				'Пока показано только состояние туннелей.'));
		if (st.dns_ok === false)
			out.push(awg.banner('warn', 'dnsmasq без поддержки nftset',
				'Домены из списков не заворачиваются, работают только подсети. Нужен пакет dnsmasq-full — запустите install.sh ещё раз.'));
		var errors = Array.isArray(st.errors) ? st.errors : [];
		if (errors.length)
			out.push(E('div', { 'class': 'awg-banner awg-banner-warn' }, [
				E('strong', {}, txt('Ошибки в настройках:')),
				E('ul', { 'style': 'margin:.3em 0 0 1.2em' }, errors.map(function(e) { return E('li', {}, txt(e)); }))
			]));
		(st.groups || []).forEach(function(g) {
			if (g.state === 'down')
				out.push(awg.banner('bad', '✕ Группа «' + (g.label || g.name) + '» без связи',
					g.route === 'blocked' ? 'Все её туннели недоступны, её сайты заблокированы kill switch.' :
						'Все её туннели недоступны, её сайты идут напрямую через провайдера.'));
		});
		return out;
	},

	// ---- состояние службы и быстрое переключение
	buildService: function(st) {
		var self = this;
		var groups = Array.isArray(st.groups) ? st.groups : null;
		var full = st.mode === 'full';
		var svc = st.enabled === false || st.enabled === '0' ? awg.badge('off', '○ Выключена в настройках') :
			(st.running ? awg.badge('ok', '● Работает') : awg.badge('bad', '✕ Остановлена'));
		var rest = full ? (groups ? 'через группу «' + groupLabel(st, st.full_group) + '»' : 'через туннель «' + (st.full_tunnel || '?') + '»') +
			(st.full_killswitch === false || st.full_killswitch === '0' ? ' (если она недоступна — напрямую)' : ' (если она недоступна — блокируется)') :
			'напрямую через провайдера';

		var left = awg.card('Состояние службы', [
			awg.kv([
				[ 'Служба', svc ],
				[ 'Режим', txt(full ? 'Полный — через VPN всё, кроме исключений' : 'Раздельный — через VPN только списки групп') ],
				[ 'Всё остальное', txt(rest) ],
				full ? [ 'Исключения', txt('доменов: ' + (st.bypass_domains || 0) + ' · IP из DNS: ' + (st.bypass_ips || 0) +
					' · подсетей: ' + (st.bypass_subnets || 0) + (nonEmpty(st.bypass_missing) ? ' · не скачаны: ' + st.bypass_missing : '')) ] : null,
				[ 'Списки обновлялись', txt(awg.fmtAgo(st.last_update)) ],
				[ 'Не скачались', nonEmpty(st.failed_lists) ? [ awg.badge('warn', '⚠ ' + st.failed_lists) ] : txt('всё в порядке') ]
			]),
			E('div', { 'class': 'awg-btns', 'style': 'margin-top:12px' }, [
				awg.button('⟳ Перезапустить службу', 'cbi-button-apply', function() {
					return awg.callRestart().then(function() {
						awg.note('Перезапуск запущен. Состояние обновится через несколько секунд.');
						self.refreshSoon();
					}).catch(awg.rpcError);
				}),
				awg.button('⇩ Обновить списки', 'cbi-button-action', function() {
					return awg.callUpdate().then(function() {
						awg.note('Списки качаются в фоне — через минуту обновятся цифры на этой странице.');
					}).catch(awg.rpcError);
				})
			])
		]);

		function seg(label, active, mode, group, what) {
			return E('button', {
				'type': 'button',
				'class': 'btn ' + (active ? 'cbi-button-positive' : 'cbi-button-action'),
				'disabled': active ? '' : null,
				'aria-pressed': active ? 'true' : 'false',
				'click': active ? null : ui.createHandlerFn(null, function() { return self.setDefault(mode, group, what); })
			}, txt((active ? '✔ ' : '') + label));
		}

		var curGroup = st.full_group || (groups && groups[0] && groups[0].name) || '';
		var gbtns = (groups || []).map(function(g) {
			return seg(g.label || g.name, g.name === curGroup, '', g.name, 'Всё остальное теперь пойдёт через группу «' + (g.label || g.name) + '».');
		});

		var right = awg.card('Быстрое переключение', [
			E('div', { 'class': 'awg-field' }, [
				E('label', {}, txt('Режим')),
				E('div', { 'class': 'awg-seg' }, [
					seg('Раздельный: через VPN только списки', !full, 'split', '', 'Включаю раздельный режим.'),
					seg('Полный: через VPN всё, кроме исключений', full, 'full', '', 'Включаю полный режим.')
				])
			]),
			groups ? E('div', { 'class': 'awg-field' }, [
				E('label', {}, txt('Всё остальное (в полном режиме) идёт через группу')),
				gbtns.length ? E('div', { 'class': 'awg-seg' }, gbtns) : awg.muted('Групп пока нет — создайте их на вкладке «Группы и списки».'),
				awg.muted(full ? 'Сайты из списков групп всё равно идут через свои группы, исключения — напрямую.' :
					'Сейчас включён раздельный режим, этот выбор начнёт действовать в полном режиме.', 'div')
			]) : ''
		]);

		return [ E('div', { 'class': 'awg-grid' }, [ left, right ]) ];
	},

	// ---- v1: только туннели
	buildV1Tunnels: function(st) {
		var tunnels = Array.isArray(st.tunnels) ? st.tunnels : [];
		return [ awg.card('Туннели', [
			tunnels.length ? E('div', { 'class': 'awg-chain' }, tunnels.map(function(t) {
				return E('div', { 'class': 'awg-chip' }, [
					E('div', {}, [ E('strong', {}, txt(t.label || t.name)) ]),
					E('div', {}, [ awg.tunnelBadge(t.state) ]),
					E('div', { 'class': 'awg-muted awg-small' }, txt(awg.fmtHandshake(t.handshake_age)))
				]);
			})) : awg.muted('Нет включённых туннелей.')
		]) ];
	},

	// ---- карточки групп: каждая обновляется отдельно, поле выбора не пересоздаётся без нужды
	updateGroups: function(st) {
		var self = this;
		var box = this.groupsBox;
		if (!Array.isArray(st.groups)) {
			awg.patch(box, { v1: st.tunnels || [] }, function() { return self.buildV1Tunnels(st); });
			this.groupNodes = null;
			return;
		}
		var tm = tunnelMap(st);
		var names = st.groups.map(function(g) { return g.name; });
		if (!this.groupNodes || this.groupNodes.__names !== names.join(',')) {
			this.groupNodes = { __names: names.join(',') };
			var grid = E('div', { 'class': 'awg-grid' });
			st.groups.forEach(function(g) {
				var info = E('div'), ctl = E('div', { 'style': 'margin-top:10px' });
				var panel = E('div', { 'class': 'awg-panel' }, [ info, ctl ]);
				self.groupNodes[g.name] = { panel: panel, info: info, ctl: ctl };
				grid.appendChild(panel);
			});
			box.__awgSig = null;
			dom.content(box, [ E('h3', { 'style': 'margin:0 0 .6em' }, txt('Группы')),
				names.length ? grid : awg.card(null, [
					awg.muted('Групп пока нет. Откройте вкладку «Туннели», импортируйте .conf, затем на вкладке «Группы и списки» ' +
						'создайте группу и отметьте, какие сайты через неё пускать.')
				]) ]);
		}
		st.groups.forEach(function(g) {
			var n = self.groupNodes[g.name];
			var gs = GSTATE[g.state] || [ 'off', '', '' ];
			n.panel.className = 'awg-panel ' + gs[2];
			var mt = (g.members || []).map(function(m) { return tm[m] || { name: m }; });
			awg.patch(n.info, [ g, mt ], function() { return groupInfo(g, tm); });
			awg.patch(n.ctl, [ g.members, g.active, g.pinned, mt.map(function(t) { return t.label; }) ],
				function() { return groupControls(self, g, tm); });
		});
	},

	update: function(st) {
		var self = this;
		st.__ok = true;
		awg.patch(this.bannerBox, this.buildBannersSig(st), function() { return self.buildBanners(st); });
		var svcSig = [ st.enabled, st.running, st.mode, st.full_group, st.full_tunnel, st.full_killswitch, st.bypass_domains,
			st.bypass_ips, st.bypass_subnets, st.bypass_missing, awg.fmtAgo(st.last_update), st.failed_lists,
			(st.groups || []).map(function(g) { return [ g.name, g.label ]; }) ];
		awg.patch(this.serviceBox, svcSig, function() { return self.buildService(st); });
		this.updateGroups(st);
		var tm = tunnelMap(st);
		awg.patch(this.schemaBox, [ st.mode, st.full_group, (st.groups || []).map(function(g) {
			return [ g.label, (g.members || []).map(function(m) { return tLabel(tm, m); }) ];
		}) ], function() { return [ schema(st) ]; });
	},

	buildBannersSig: function(st) {
		return [ Array.isArray(st.groups), st.dns_ok, st.errors, (st.groups || []).map(function(g) { return [ g.name, g.label, g.state, g.route ]; }) ];
	},

	render: function(st) {
		var self = this;
		this.bannerBox = E('div');
		this.serviceBox = E('div');
		this.groupsBox = E('div', { 'style': 'margin-bottom:16px' });
		this.schemaBox = E('div');

		var root = awg.page('AWG Split', 'Выбранные сайты идут через VPN-туннели AmneziaWG, остальное — как вы настроили. ' +
			'Здесь видно, что работает прямо сейчас, и можно быстро переключиться.', [
			this.bannerBox,
			this.serviceBox,
			this.groupsBox,
			helpCard(this.schemaBox),
			pageCard()
		]);

		if (st) this.update(st);
		else dom.content(this.bannerBox, this.buildBanners({}));

		poll.add(function() { return self.refresh(); }, 10);
		return root;
	},

	handleSaveApply: null,
	handleSave: null,
	handleReset: null
});
