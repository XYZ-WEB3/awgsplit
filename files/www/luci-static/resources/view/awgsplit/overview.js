'use strict';
'require view';
'require rpc';
'require ui';
'require poll';
'require dom';

var callStatus = rpc.declare({
	object: 'luci.awgsplit',
	method: 'status',
	expect: { }
});

var callUpdate = rpc.declare({
	object: 'luci.awgsplit',
	method: 'update',
	expect: { }
});

var callRestart = rpc.declare({
	object: 'luci.awgsplit',
	method: 'restart',
	expect: { }
});

var STATE = {
	up:      [ '#2ecc71', 'Работает' ],
	pending: [ '#f39c12', 'Подключается' ],
	unknown: [ '#7f8c8d', 'Нет данных' ],
	down:    [ '#e74c3c', 'Нет связи' ],
	nodev:   [ '#e74c3c', 'Интерфейс не поднят' ]
};

// Все строки из бэкенда передаются в E() только массивом — так они вставляются как текст, а не HTML
function txt(v) { return [ String(v == null ? '' : v) ]; }

function badge(color, text) {
	return E('span', {
		'style': 'display:inline-block;padding:2px 10px;border-radius:10px;font-weight:bold;color:#fff;background:' + color
	}, txt(text));
}

function fmtAgo(ts) {
	if (!ts || ts <= 0) return 'никогда';
	var d = Math.floor(Date.now() / 1000) - ts;
	if (d < 60) return 'только что';
	if (d < 3600) return Math.floor(d / 60) + ' мин назад';
	if (d < 86400) return Math.floor(d / 3600) + ' ч назад';
	return Math.floor(d / 86400) + ' дн назад';
}

function fmtRoute(r) {
	if (r === 'tunnel') return 'через туннель';
	if (r && r.indexOf('fallback:') === 0) return 'через запасной «' + r.substr(9) + '»';
	if (r === 'direct') return 'напрямую (туннель недоступен)';
	return '—';
}

function row(title, value) {
	return E('tr', { 'class': 'tr' }, [
		E('td', { 'class': 'td left', 'width': '33%' }, [ E('strong', {}, txt(title)) ]),
		E('td', { 'class': 'td left' }, Array.isArray(value) ? value : [ value ])
	]);
}

function renderStatus(st) {
	var nodes = [];
	var tunnels = Array.isArray(st.tunnels) ? st.tunnels : [];
	var errors = Array.isArray(st.errors) ? st.errors : [];

	if (st.dns_ok === false) {
		nodes.push(E('div', { 'class': 'alert-message warning' }, [
			E('strong', {}, txt('dnsmasq без поддержки nftset. ')),
			E('span', {}, txt('Домены не заворачиваются, работают только подсети. Нужен пакет dnsmasq-full — запустите install.sh ещё раз.'))
		]));
	}
	if (errors.length) {
		nodes.push(E('div', { 'class': 'alert-message warning' }, [
			E('strong', {}, txt('Ошибки в настройках:')),
			E('ul', {}, errors.map(function(e) { return E('li', {}, txt(e)); }))
		]));
	}

	nodes.push(E('div', { 'class': 'cbi-section' }, [
		E('h3', {}, txt('Состояние службы')),
		E('table', { 'class': 'table' }, [
			row('Служба', st.enabled === false ? badge('#7f8c8d', 'Выключена в настройках') :
				(st.running ? badge('#2ecc71', 'Работает') : badge('#e74c3c', 'Остановлена'))),
			row('Списки обновлялись', txt(fmtAgo(st.last_update))),
			row('Не скачались', txt(st.failed_lists && String(st.failed_lists).trim() ? st.failed_lists : 'всё в порядке')),
			row('Активных туннелей', txt(tunnels.length))
		])
	]));

	var rows = tunnels.map(function(t) {
		var s = STATE[t.state] || [ '#7f8c8d', t.state || '—' ];
		var hs = (t.handshake_age >= 0) ? 'handshake ' + t.handshake_age + ' с назад' : 'handshake не было';
		var extra = [];
		if (t.missing_lists && String(t.missing_lists).trim())
			extra.push(E('div', { 'style': 'color:#e67e22' }, txt('не скачаны: ' + t.missing_lists)));
		return E('tr', { 'class': 'tr' }, [
			E('td', { 'class': 'td left' }, [
				E('strong', {}, txt(t.label || t.name)), E('br'),
				E('small', { 'style': 'color:#888' }, txt(t.name + ' · метка ' + t.mark + ' · табл. ' + t.table))
			]),
			E('td', { 'class': 'td left' }, [
				E('code', {}, txt(t.interface)), E('br'),
				E('small', { 'style': 'color:#888' }, txt(t.proto || 'интерфейса нет в network'))
			]),
			E('td', { 'class': 'td left' }, [
				badge(s[0], s[1]), E('br'),
				E('small', { 'style': 'color:#888' }, txt(hs))
			]),
			E('td', { 'class': 'td left' }, txt(fmtRoute(t.route))),
			E('td', { 'class': 'td left' }, [
				E('div', {}, txt('доменов: ' + (t.domains || 0))),
				E('div', {}, txt('IP из DNS: ' + (t.ips || 0))),
				E('div', {}, txt('подсетей: ' + (t.subnets || 0)))
			].concat(extra)),
			E('td', { 'class': 'td left' }, txt(t.dns || 'провайдера'))
		]);
	});

	if (!rows.length) {
		rows = [ E('tr', { 'class': 'tr' }, [
			E('td', { 'class': 'td', 'colspan': '6', 'style': 'text-align:center;color:#888' },
				txt('Нет включённых туннелей. Заведите их на вкладке «Туннели и списки».'))
		]) ];
	}

	nodes.push(E('div', { 'class': 'cbi-section' }, [
		E('h3', {}, txt('Туннели')),
		E('table', { 'class': 'table' }, [
			E('tr', { 'class': 'tr table-titles' }, [
				E('th', { 'class': 'th left' }, txt('Туннель')),
				E('th', { 'class': 'th left' }, txt('Интерфейс')),
				E('th', { 'class': 'th left' }, txt('Связь')),
				E('th', { 'class': 'th left' }, txt('Трафик идёт')),
				E('th', { 'class': 'th left' }, txt('Содержимое')),
				E('th', { 'class': 'th left' }, txt('DNS'))
			])
		].concat(rows))
	]));

	return nodes;
}

return view.extend({
	handleUpdate: function() {
		return callUpdate().then(function() {
			ui.addNotification(null, E('p', {}, txt('Списки качаются в фоне — через минуту обновятся цифры на этой странице.')), 'info');
		}).catch(function(e) {
			ui.addNotification(null, E('p', {}, txt('Не удалось: ' + e)), 'danger');
		});
	},

	handleRestart: function() {
		return callRestart().then(function() {
			ui.addNotification(null, E('p', {}, txt('Перезапуск запущен. Состояние обновится через несколько секунд.')), 'info');
		}).catch(function(e) {
			ui.addNotification(null, E('p', {}, txt('Не удалось: ' + e)), 'danger');
		});
	},

	load: function() {
		return callStatus().catch(function() { return {}; });
	},

	render: function(st) {
		var box = E('div', {}, renderStatus(st || {}));

		poll.add(function() {
			return callStatus().then(function(ns) {
				if (ns) dom.content(box, renderStatus(ns));
			}).catch(function() {});
		}, 10);

		return E('div', {}, [
			E('h2', {}, txt('AWG Split — раздельная маршрутизация')),
			E('p', { 'style': 'color:#888' },
				txt('Сайты из списков идут через туннели AmneziaWG, всё остальное — напрямую через провайдера.')),
			box,
			E('div', { 'class': 'cbi-section' }, [
				E('h3', {}, txt('Как это работает')),
				E('p', {}, txt(
					'dnsmasq резолвит домен из списка через DNS туннеля и кладёт полученный IP в nft-сет. ' +
					'nftables помечает новое соединение к этому IP, ip rule отправляет его в таблицу туннеля. ' +
					'Всё внутри ядра, без прокси. Если туннель упал — трафик уходит в запасной или напрямую.')),
				E('p', { 'style': 'color:#888' }, txt(
					'«IP из DNS» растёт по мере того, как устройства открывают сайты. Если там 0 — устройства ' +
					'ещё не обращались к доменам из списков или их DNS идёт мимо роутера (DoH в браузере, свой DNS в настройках).'))
			]),
			E('div', { 'class': 'cbi-page-actions' }, [
				E('button', {
					'class': 'btn cbi-button-apply',
					'click': ui.createHandlerFn(this, 'handleRestart')
				}, txt('Перезапустить службу')),
				' ',
				E('button', {
					'class': 'btn cbi-button-action',
					'click': ui.createHandlerFn(this, 'handleUpdate')
				}, txt('Обновить списки'))
			])
		]);
	},

	handleSaveApply: null,
	handleSave: null,
	handleReset: null
});
