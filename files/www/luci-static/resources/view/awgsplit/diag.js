'use strict';
'require view';
'require rpc';
'require ui';
'require uci';

var callExplain = rpc.declare({
	object: 'luci.awgsplit',
	method: 'explain',
	params: [ 'target' ],
	expect: { }
});

var callDump = rpc.declare({
	object: 'luci.awgsplit',
	method: 'dump',
	params: [ 'tunnel' ],
	expect: { }
});

function txt(v) { return [ String(v == null ? '' : v) ]; }

var PRE = 'background:#1e1e1e;color:#ecf0f1;padding:12px;max-height:500px;overflow:auto;font-size:12px;white-space:pre-wrap';

return view.extend({
	load: function() {
		return uci.load('awgsplit');
	},

	handleDump: function() {
		var sel = document.getElementById('awg_diag_tunnel');
		var out = document.getElementById('awg_diag_out');
		if (!sel || !sel.value) return;

		out.textContent = 'Собираю…';
		return callDump(sel.value).then(function(res) {
			out.textContent = (res && res.output) ? res.output : 'Пусто';
		}).catch(function(e) {
			out.textContent = 'Ошибка: ' + e;
		});
	},

	handleExplain: function() {
		var inp = document.getElementById('awg_explain_target');
		var out = document.getElementById('awg_explain_out');
		var target = (inp && inp.value || '').trim().replace(/^https?:\/\//i, '').replace(/[\/?#].*$/, '');
		if (!target) return;

		out.textContent = 'Проверяю…';
		return callExplain(target).then(function(res) {
			out.textContent = (res && res.output) ? res.output : 'Пусто';
		}).catch(function(e) {
			out.textContent = 'Ошибка: ' + e;
		});
	},

	render: function() {
		var opts = uci.sections('awgsplit', 'tunnel').map(function(s) {
			return E('option', { 'value': s['.name'] }, txt((s.label || s['.name']) + ' (' + s['.name'] + ')'));
		});

		return E('div', {}, [
			E('h2', {}, txt('Диагностика')),

			E('div', { 'class': 'cbi-section' }, [
				E('h3', {}, txt('Проверить сайт: куда он пойдёт и почему')),
				E('p', {}, txt(
					'Введите домен или IP. Роутер по своим реальным правилам покажет, пойдёт ли адрес в туннель или напрямую, ' +
					'и в каком списке он нашёлся. Если сайт должен идти напрямую, а идёт в туннель, здесь видна причина.')),
				E('div', { 'class': 'cbi-value' }, [
					E('label', { 'class': 'cbi-value-title', 'for': 'awg_explain_target' }, txt('Сайт или IP')),
					E('div', { 'class': 'cbi-value-field' }, [
						E('input', {
							'id': 'awg_explain_target', 'class': 'cbi-input-text', 'type': 'text',
							'placeholder': 'wotpack.ru', 'style': 'min-width:18em',
							'keydown': function(ev) { if (ev.keyCode === 13) document.getElementById('awg_explain_btn').click(); }
						}),
						' ',
						E('button', {
							'id': 'awg_explain_btn', 'class': 'btn cbi-button-action',
							'click': ui.createHandlerFn(this, 'handleExplain')
						}, txt('Проверить'))
					])
				]),
				E('pre', { 'id': 'awg_explain_out', 'style': PRE }, txt('Введите сайт и нажмите «Проверить».'))
			]),

			E('div', { 'class': 'cbi-section' }, [
				E('h3', {}, txt('Содержимое сетов и маршрутов')),
				E('p', {}, txt(
					'Показывает, что реально лежит в nft-сетах, какие ip rule активны, что в таблице маршрутизации ' +
					'и когда был последний handshake. Если сет IP пуст — устройства ещё не обращались к доменам из списков ' +
					'или их DNS идёт мимо роутера.')),
				E('div', { 'class': 'cbi-value' }, [
					E('label', { 'class': 'cbi-value-title', 'for': 'awg_diag_tunnel' }, txt('Туннель')),
					E('div', { 'class': 'cbi-value-field' }, [
						opts.length
							? E('select', { 'id': 'awg_diag_tunnel', 'class': 'cbi-input-select' }, opts)
							: E('em', {}, txt('Туннелей нет — создайте на вкладке «Туннели и списки».')),
						' ',
						E('button', {
							'class': 'btn cbi-button-action',
							'click': ui.createHandlerFn(this, 'handleDump'),
							'disabled': opts.length ? null : ''
						}, txt('Показать'))
					])
				])
			]),

			E('div', { 'class': 'cbi-section' }, [
				E('pre', { 'id': 'awg_diag_out', 'style': PRE }, txt('Нажмите «Показать».'))
			]),

			E('div', { 'class': 'cbi-section' }, [
				E('h3', {}, txt('Полезные команды в SSH')),
				E('pre', { 'style': PRE }, txt(
					'awgsplit status               # состояние в JSON\n' +
					'awgsplit dump main            # сеты, правила и маршруты туннеля main\n' +
					'awgsplit update               # обновить списки доменов\n' +
					'awgsplit start                # применить настройки\n' +
					'awgsplit restart              # полный перезапуск (сеты очищаются)\n' +
					'\n' +
					'nft list table inet awgsplit  # все правила и сеты\n' +
					'ip rule show                  # правила маршрутизации\n' +
					'ip route show table 101       # таблица туннеля main\n' +
					'awg show                      # состояние AmneziaWG\n' +
					'logread -e awgsplit           # логи службы'))
			])
		]);
	},

	handleSaveApply: null,
	handleSave: null,
	handleReset: null
});
