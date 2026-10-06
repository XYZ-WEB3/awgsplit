'use strict';
'require view';
'require rpc';
'require ui';

var callImport = rpc.declare({
	object: 'luci.awgsplit',
	method: 'import_conf',
	params: [ 'conf', 'name' ],
	expect: { }
});

var RE_IFACE = /^[A-Za-z][A-Za-z0-9_]{0,14}$/;
var RESERVED = { lan: 1, wan: 1, wan6: 1, loopback: 1, lo: 1, globals: 1, awgsplit: 1 };

function txt(v) { return [ String(v == null ? '' : v) ]; }

return view.extend({
	handleFile: function(ev) {
		var f = ev.target.files && ev.target.files[0];
		if (!f) return;
		if (f.size > 65536) {
			ui.addNotification(null, E('p', {}, txt('Файл слишком большой — это точно .conf?')), 'danger');
			return;
		}
		var reader = new FileReader();
		reader.onload = function() {
			document.getElementById('awg_conf_text').value = String(reader.result || '');
		};
		reader.readAsText(f);
	},

	handleImport: function(ev) {
		var name = document.getElementById('awg_iface_name').value.trim();
		var conf = document.getElementById('awg_conf_text').value;

		if (!RE_IFACE.test(name) || RESERVED[name]) {
			ui.addNotification(null, E('p', {},
				txt('Имя интерфейса: латиница, цифры и _, с буквы, до 15 символов, не lan/wan (например awg_main).')), 'danger');
			return;
		}
		if (!/\[Interface\]/i.test(conf) || !/\[Peer\]/i.test(conf)) {
			ui.addNotification(null, E('p', {},
				txt('Вставьте содержимое .conf целиком — нужны секции [Interface] и [Peer].')), 'danger');
			return;
		}

		ui.showModal('Импорт', [ E('p', { 'class': 'spinning' }, txt('Разбираю конфиг и создаю интерфейс…')) ]);

		return callImport(conf, name).then(function(res) {
			var ok = (res && res.code === 0);
			ui.showModal(ok ? 'Готово' : 'Ошибка импорта', [
				E('pre', {
					'style': 'max-height:340px;overflow:auto;white-space:pre-wrap;background:#1e1e1e;color:#ecf0f1;padding:10px'
				}, txt(res && res.output ? res.output : 'Нет вывода')),
				E('div', { 'class': 'right' }, [
					E('button', { 'class': 'btn', 'click': ui.hideModal }, txt('Закрыть'))
				])
			]);
			if (ok) document.getElementById('awg_conf_text').value = '';
		}).catch(function(e) {
			ui.hideModal();
			ui.addNotification(null, E('p', {}, txt('Не удалось: ' + e)), 'danger');
		});
	},

	render: function() {
		return E('div', {}, [
			E('h2', {}, txt('Импорт конфига AmneziaVPN')),

			E('div', { 'class': 'cbi-section' }, [
				E('p', {}, txt(
					'Возьмите .conf из AmneziaVPN (поделиться подключением → формат AmneziaWG → сохранить файл) ' +
					'и загрузите его или вставьте текст целиком. Поддерживаются все поля AmneziaWG 1.x–3.x: ' +
					'Jc/Jmin/Jmax, S1–S4, H1–H4, I1–I5, HeaderProtectionKey, RandomTrailers, DisableCookies, ' +
					'таймеры с диапазонами. Всё проверяется до записи — при ошибке настройки роутера не меняются.')),
				E('p', { 'class': 'alert-message warning' }, txt(
					'У пира всегда ставится route_allowed_ips=0: иначе AllowedIPs = 0.0.0.0/0 увёл бы в туннель весь трафик. ' +
					'DNS из конфига используется только для доменов из списков awgsplit.'))
			]),

			E('div', { 'class': 'cbi-section' }, [
				E('div', { 'class': 'cbi-value' }, [
					E('label', { 'class': 'cbi-value-title', 'for': 'awg_iface_name' }, txt('Имя интерфейса')),
					E('div', { 'class': 'cbi-value-field' }, [
						E('input', {
							'type': 'text',
							'id': 'awg_iface_name',
							'class': 'cbi-input-text',
							'value': 'awg_main',
							'maxlength': '15',
							'placeholder': 'awg_main'
						}),
						E('div', { 'class': 'cbi-value-description' }, txt(
							'Основной сервер — awg_main, второй — awg_second: такие имена уже прописаны в туннелях. ' +
							'Повторный импорт с тем же именем заменит настройки интерфейса.'))
					])
				]),
				E('div', { 'class': 'cbi-value' }, [
					E('label', { 'class': 'cbi-value-title' }, txt('Файл .conf')),
					E('div', { 'class': 'cbi-value-field' }, [
						E('input', {
							'type': 'file',
							'accept': '.conf,.txt,text/plain',
							'change': ui.createHandlerFn(this, 'handleFile')
						})
					])
				]),
				E('div', { 'class': 'cbi-value' }, [
					E('label', { 'class': 'cbi-value-title', 'for': 'awg_conf_text' }, txt('Или текст .conf')),
					E('div', { 'class': 'cbi-value-field' }, [
						E('textarea', {
							'id': 'awg_conf_text',
							'class': 'cbi-input-textarea',
							'style': 'width:100%;font-family:monospace',
							'rows': '22',
							'wrap': 'off',
							'spellcheck': 'false',
							'placeholder': '[Interface]\nAddress = 10.8.0.2/32\nPrivateKey = ...\nJc = 6\n...\n\n[Peer]\nPublicKey = ...\nEndpoint = 1.2.3.4:35574\n...'
						})
					])
				])
			]),

			E('div', { 'class': 'cbi-page-actions' }, [
				E('button', {
					'class': 'btn cbi-button-apply',
					'click': ui.createHandlerFn(this, 'handleImport')
				}, txt('Импортировать'))
			]),

			E('div', { 'class': 'cbi-section' }, [
				E('h3', {}, txt('После импорта')),
				E('ol', {}, [
					E('li', {}, txt('Интерфейс поднимется сам (если AmneziaWG ставили без перезагрузки — перезагрузите роутер).')),
					E('li', {}, txt('На вкладке «Туннели и списки» проверьте, что интерфейс выбран в нужном туннеле, и нажмите «Сохранить и применить».')),
					E('li', {}, txt('На вкладке «Обзор» связь туннеля должна стать «Работает».'))
				])
			])
		]);
	},

	handleSaveApply: null,
	handleSave: null,
	handleReset: null
});
