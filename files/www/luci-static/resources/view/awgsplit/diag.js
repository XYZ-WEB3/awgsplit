'use strict';
'require view';
'require ui';
'require uci';
'require view.awgsplit.common as awg';

var txt = awg.txt;

return view.extend({
	load: function() {
		return uci.load(awg.CONF);
	},

	handleExplain: function(inp, out) {
		var target = (inp.value || '').trim().replace(/^https?:\/\//i, '').replace(/[\/?#].*$/, '');
		if (!target) { out.textContent = 'Введите сайт или IP-адрес.'; return; }
		out.textContent = 'Проверяю…';
		return awg.callExplain(target).then(function(res) {
			out.textContent = (res && res.output) ? res.output : 'Пусто';
		}).catch(function(e) {
			out.textContent = 'Ошибка: ' + e;
		});
	},

	handleDump: function(sel, out) {
		if (!sel || !sel.value) return;
		out.textContent = 'Собираю…';
		return awg.callDump(sel.value).then(function(res) {
			out.textContent = (res && res.output) ? res.output : 'Пусто';
		}).catch(function(e) {
			out.textContent = 'Ошибка: ' + e;
		});
	},

	render: function() {
		var self = this;
		var tunnels = awg.sections('tunnel');

		var inp = E('input', { 'type': 'text', 'class': 'cbi-input-text', 'placeholder': 'например, youtube.com', 'style': 'flex:1 1 16em;min-width:0',
			'aria-label': 'Сайт или IP-адрес' });
		var exOut = E('pre', { 'class': 'awg-pre', 'aria-live': 'polite' }, txt('Введите сайт и нажмите «Проверить».'));
		var exBtn = E('button', { 'type': 'button', 'class': 'btn cbi-button-action',
			'click': ui.createHandlerFn(this, function() { return self.handleExplain(inp, exOut); }) }, txt('Проверить'));
		inp.addEventListener('keydown', function(ev) { if (ev.keyCode === 13) exBtn.click(); });

		var sel = tunnels.length ? awg.select(tunnels.map(function(s) {
			return [ s['.name'], awg.sectionLabel(s) + ' (' + s['.name'] + ')' ];
		}), tunnels[0]['.name'], { 'aria-label': 'Туннель' }) : null;
		var dumpOut = E('pre', { 'class': 'awg-pre' }, txt('Выберите туннель и нажмите «Показать».'));

		return awg.page('Диагностика', 'Если какой-то сайт идёт не туда, начните с «Проверить сайт».', [
			awg.card('Проверить сайт: куда он пойдёт и почему', [
				E('p', {}, txt('Введите домен или IP. Роутер по своим настоящим правилам покажет, пойдёт ли адрес через VPN (и через какую группу) ' +
					'или напрямую, и в каком списке он нашёлся.')),
				E('div', { 'class': 'awg-btns' }, [ inp, exBtn ]),
				exOut
			]),

			awg.card('Что лежит внутри (для опытных)', [
				E('p', {}, txt('Содержимое nft-сетов, активные ip rule, таблица маршрутизации и время последнего рукопожатия. ' +
					'Если сет IP пуст — устройства ещё не открывали сайты из списков или их DNS идёт мимо роутера.')),
				E('div', { 'class': 'awg-btns' }, sel ? [
					sel,
					E('button', { 'type': 'button', 'class': 'btn cbi-button-action',
						'click': ui.createHandlerFn(this, function() { return self.handleDump(sel, dumpOut); }) }, txt('Показать'))
				] : [ E('em', {}, txt('Туннелей нет — добавьте их на вкладке «Туннели».')) ]),
				dumpOut
			]),

			awg.card('Полезные команды в SSH', [
				E('pre', { 'class': 'awg-pre' }, txt(
					'awgsplit status               # состояние в JSON\n' +
					'awgsplit dump <туннель>       # сеты, правила и маршруты\n' +
					'awgsplit explain youtube.com  # куда пойдёт сайт\n' +
					'awgsplit update               # обновить списки доменов\n' +
					'awgsplit start                # применить настройки\n' +
					'awgsplit restart              # полный перезапуск (сеты очищаются)\n' +
					'\n' +
					'nft list table inet awgsplit  # все правила и сеты\n' +
					'ip rule show                  # правила маршрутизации\n' +
					'awg show                      # состояние AmneziaWG\n' +
					'logread -e awgsplit           # журнал службы'))
			])
		]);
	},

	handleSaveApply: null,
	handleSave: null,
	handleReset: null
});
