'use strict';
'require view';
'require form';
'require uci';
'require view.awgsplit.common as awg';

var txt = awg.txt;

return view.extend({
	load: function() {
		return uci.load(awg.CONF);
	},

	render: function() {
		var m, s, o;

		m = new form.Map(awg.CONF, null, null);

		function sect(title, descr) {
			var sc = m.section(form.NamedSection, 'global', 'awgsplit', title, descr);
			sc.anonymous = true;
			sc.addremove = false;
			return sc;
		}

		// ------------------------------------------------ служба
		s = sect('Служба');

		o = s.option(form.Flag, 'enabled', 'Включить awgsplit',
			'Если выключить, весь трафик пойдёт напрямую через провайдера, как будто awgsplit не установлен.');
		o.default = '1';
		o.rmempty = false;

		o = s.option(form.Value, 'update_interval', 'Обновлять готовые списки сайтов каждые, часов',
			'Списки скачиваются из интернета. 72 часа — разумно; обновить сразу можно на «Обзоре».');
		o.datatype = 'range(1,720)';
		o.default = '72';
		o.placeholder = '72';

		// ------------------------------------------------ проверка туннелей
		s = sect('Проверка связи туннелей',
			'Роутер регулярно проверяет каждый туннель по времени последнего рукопожатия с сервером. ' +
			'Если туннель перестал отвечать, его группа переходит на следующий туннель по приоритету.');

		o = s.option(form.Flag, 'healthcheck', 'Следить за туннелями',
			'Без этого переключения на запасной туннель не будет.');
		o.default = '1';
		o.rmempty = false;

		o = s.option(form.Value, 'healthcheck_interval', 'Проверять каждые, секунд',
			'Меньше — быстрее замечается обрыв, но чаще работа для роутера. 60 подходит большинству.');
		o.datatype = 'range(10,3600)';
		o.default = '60';
		o.placeholder = '60';
		o.depends('healthcheck', '1');

		// ------------------------------------------------ защита и страница
		s = sect('Защита от утечек и страница «ВПН упал»');

		o = s.option(form.Flag, 'block_doh_canary', 'Не давать браузерам обходить DNS роутера',
			'Выключает «DNS через HTTPS» в Firefox и iCloud Private Relay. Иначе их запросы идут мимо роутера, ' +
			'и сайты из списков не попадают в VPN.');
		o.default = '1';
		o.rmempty = false;

		o = s.option(form.Flag, 'down_page', 'Показывать страницу «ВПН упал»',
			'Когда VPN недоступен, телефоны и компьютеры сами откроют страницу с предупреждением (как окно входа в Wi-Fi). ' +
			'Один раз за разрыв. Какую страницу показывать — выбирается на «Обзоре».');
		o.default = '1';
		o.rmempty = false;

		o = s.option(form.Value, 'down_page_secs', 'Сколько держать страницу, секунд');
		o.datatype = 'range(30,3600)';
		o.default = '300';
		o.placeholder = '300';
		o.depends('down_page', '1');

		// ------------------------------------------------ сеть и журнал
		s = sect('Сеть и журнал');

		o = s.option(form.DynamicList, 'lan_ifaces', 'Сетевые устройства клиентов',
			'Трафик с каких устройств роутера обрабатывать. Обычно это br-lan (вся домашняя сеть). Меняйте, только если знаете зачем.');
		o.placeholder = 'br-lan';
		o.validate = function(section_id, value) {
			if (!value) return true;
			return /^[A-Za-z0-9_.-]{1,15}$/.test(value) ? true : 'Неверное имя устройства';
		};

		o = s.option(form.ListValue, 'log_level', 'Подробность журнала',
			'Журнал — «Состояние → Системный журнал» или logread -e awgsplit в SSH.');
		o.value('error', 'Только ошибки');
		o.value('info', 'Обычная');
		o.value('debug', 'Отладочная (для поиска проблем)');
		o.default = 'info';

		return m.render().then(function(node) {
			return awg.page('Настройки', 'Общие параметры службы. Обычно их не нужно менять.', [
				awg.banner('info', 'Где остальное', [
					E('span', {}, txt('Режим (раздельный/полный), группы, списки сайтов и исключения — на вкладке ')),
					E('a', { 'href': L.url('admin/services/awgsplit/groups') }, txt('«Группы и списки»')),
					E('span', {}, txt('. Уведомления — на вкладке ')),
					E('a', { 'href': L.url('admin/services/awgsplit/telegram') }, txt('«Telegram»')),
					E('span', {}, txt('.'))
				]),
				node
			]);
		});
	}
});
