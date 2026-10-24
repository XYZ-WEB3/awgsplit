'use strict';
'require view';
'require form';
'require uci';
'require rpc';

var callInterfaces = rpc.declare({
	object: 'luci.awgsplit',
	method: 'interfaces',
	expect: { interfaces: [] }
});

// Готовые списки itdoginfo/allow-domains (те же, что в Podkop)
var COMMUNITY = [
	[ 'russia_inside',  'Россия внутри — заблокированное в РФ + зарубежные сервисы, блокирующие РФ-IP (для роутера в России)' ],
	[ 'russia_outside', 'Россия снаружи — российские сервисы, доступные только с РФ-IP (для роутера за границей; в зарубежный туннель не включать)' ],
	[ 'telegram',       'Telegram (домены + подсети)' ],
	[ 'meta',           'Meta: Instagram, Facebook, WhatsApp (домены + подсети)' ],
	[ 'twitter',        'Twitter / X (домены + подсети)' ],
	[ 'discord',        'Discord (домены + голосовые подсети)' ],
	[ 'youtube',        'YouTube' ],
	[ 'tiktok',         'TikTok' ],
	[ 'google_ai',      'Google AI: Gemini, AI Studio' ],
	[ 'google_play',    'Google Play' ],
	[ 'google_meet',    'Google Meet (домены + подсети)' ],
	[ 'cloudflare',     'Cloudflare (домены + подсети)' ],
	[ 'cloudfront',     'Amazon CloudFront (домены + подсети)' ],
	[ 'hdrezka',        'HDRezka' ],
	[ 'roblox',         'Roblox (домены + подсети)' ],
	[ 'digitalocean',   'DigitalOcean (домены + подсети)' ],
	[ 'hetzner',        'Hetzner (домены + подсети)' ],
	[ 'ovh',            'OVH (домены + подсети)' ],
	[ 'geoblock',       'Геоблок — сервисы, закрывшие доступ из РФ' ],
	[ 'block',          'Заблокированные в РФ (категория)' ],
	[ 'news',           'Новости' ],
	[ 'anime',          'Аниме' ],
	[ 'porn',           'Для взрослых' ],
	[ 'hodca',          'HODCA' ]
];

var RE_SECTION = /^[A-Za-z][A-Za-z0-9_]{0,23}$/;
var RE_IP4 = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;

function parseMark(v) {
	v = String(v == null ? '' : v).trim();
	var n = NaN;
	if (/^0x[0-9a-f]{1,8}$/i.test(v)) n = parseInt(v, 16);
	else if (/^[1-9][0-9]{0,9}$/.test(v)) n = parseInt(v, 10);
	return (n > 0 && n <= 0xffffffff) ? n : NaN;
}

function otherTunnels(section_id) {
	return uci.sections('awgsplit', 'tunnel').filter(function(s) {
		return s['.name'] !== section_id;
	});
}

function nextFree(key, parse, from, to) {
	var used = {};
	uci.sections('awgsplit', 'tunnel').forEach(function(s) { used[parse(s[key])] = true; });
	for (var i = from; i <= to; i++)
		if (!used[i]) return i;
	return from;
}

function checkSectionName(section_id) {
	return RE_SECTION.test(section_id) ? true :
		'Имя секции «' + section_id + '» не подходит: латиница, цифры и _, с буквы, до 24 символов. Удалите и создайте заново.';
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

return view.extend({
	load: function() {
		return Promise.all([
			callInterfaces().catch(function() { return []; }),
			uci.load('awgsplit'),
			uci.load('network')
		]);
	},

	render: function(data) {
		var ifaces = Array.isArray(data[0]) ? data[0] : [];
		var m, s, o;

		m = new form.Map('awgsplit', 'Туннели и списки',
			'Каждый туннель — отдельный интерфейс AmneziaWG со своей таблицей маршрутизации. ' +
			'Домены и подсети из его списков идут в этот туннель, всё остальное — напрямую через провайдера. ' +
			'Если адрес подходит нескольким туннелям, порядок такой: свои подсети → свои домены → ' +
			'домены готовых списков → подсети готовых списков; на одном уровне побеждает туннель с меньшим приоритетом. ' +
			'Более точный домен (api.example.com) всегда главнее общего (example.com).');

		// ------------------------------------------------ общие настройки
		s = m.section(form.NamedSection, 'global', 'awgsplit', 'Общие настройки');
		s.anonymous = true;
		s.addremove = false;

		o = s.option(form.Flag, 'enabled', 'Включить awgsplit');
		o.default = '1';
		o.rmempty = false;

		o = s.option(form.Value, 'update_interval', 'Обновлять списки каждые (часов)');
		o.datatype = 'range(1,720)';
		o.default = '72';
		o.placeholder = '72';

		o = s.option(form.Flag, 'healthcheck', 'Следить за живостью туннелей',
			'По времени последнего handshake. Если туннель упал — его трафик уходит в запасной туннель, а если запасного нет — напрямую.');
		o.default = '1';
		o.rmempty = false;

		o = s.option(form.Value, 'healthcheck_interval', 'Интервал проверки (сек)');
		o.datatype = 'range(10,3600)';
		o.default = '60';
		o.placeholder = '60';

		o = s.option(form.Flag, 'block_doh_canary', 'Не давать браузерам обходить DNS роутера',
			'Выключает DNS-over-HTTPS в Firefox и iCloud Private Relay. Иначе их запросы идут мимо роутера и сайты не заворачиваются.');
		o.default = '1';
		o.rmempty = false;

		o = s.option(form.Flag, 'down_page', 'Показывать страницу «ВПН упал»',
			'Когда туннель недоступен, роутер подменяет служебные проверки интернета Windows, Android и iOS — система сама открывает страницу. Один раз за разрыв.');
		o.default = '1';
		o.rmempty = false;

		o = s.option(form.Value, 'down_page_secs', 'Сколько держать страницу (сек)');
		o.datatype = 'range(30,3600)';
		o.default = '300';
		o.placeholder = '300';
		o.depends('down_page', '1');

		o = s.option(form.DynamicList, 'lan_ifaces', 'Устройства LAN',
			'Трафик с каких сетевых устройств заворачивать. Обычно это br-lan.');
		o.placeholder = 'br-lan';
		o.validate = function(section_id, value) {
			if (!value) return true;
			return /^[A-Za-z0-9_.-]{1,15}$/.test(value) ? true : 'Неверное имя устройства';
		};

		o = s.option(form.ListValue, 'log_level', 'Подробность логов');
		o.value('error', 'Только ошибки');
		o.value('info', 'Обычная');
		o.value('debug', 'Отладочная');
		o.default = 'info';

		// ------------------------------------------------ туннели
		s = m.section(form.GridSection, 'tunnel', 'Туннели',
			'Имя новой секции — латиница, цифры и _, с буквы (например second).');
		s.addremove = true;
		s.anonymous = false;
		s.nodescriptions = true;
		s.addbtntitle = 'Добавить туннель';

		o = s.option(form.Flag, 'enabled', 'Вкл');
		o.editable = true;
		o.default = '1';
		o.rmempty = false;

		o = s.option(form.Value, 'label', 'Название');
		o.placeholder = 'Основной VPN';
		o.editable = true;

		o = s.option(form.ListValue, 'interface', 'Интерфейс',
			'Интерфейс AmneziaWG. Создаётся на вкладке «Импорт конфига».');
		var known = {};
		ifaces.forEach(function(i) {
			known[i.name] = true;
			o.value(i.name, i.name + ' (' + i.proto + ')');
		});
		uci.sections('awgsplit', 'tunnel').forEach(function(sc) {
			if (sc.interface && !known[sc.interface]) {
				known[sc.interface] = true;
				o.value(sc.interface, sc.interface + ' (ещё не создан)');
			}
		});
		if (!ifaces.length)
			o.value('', '— нет интерфейсов, сначала импортируйте .conf —');
		o.rmempty = false;
		o.validate = function(section_id, value) {
			var r = checkSectionName(section_id);
			if (r !== true) return r;
			if (!value) return 'Выберите интерфейс';
			var clash = otherTunnels(section_id).filter(function(t) { return t.interface === value; });
			return clash.length ? 'Этот интерфейс уже занят туннелем «' + clash[0]['.name'] + '»' : true;
		};

		o = s.option(form.Value, 'fwmark', 'Метка пакетов',
			'Уникальная для каждого туннеля, например 0x1001.');
		o.modalonly = true;
		o.rmempty = false;
		o.default = '0x' + nextFree('fwmark', parseMark, 0x1001, 0x10ff).toString(16);
		o.validate = function(section_id, value) {
			var n = parseMark(value);
			if (isNaN(n)) return 'Нужно число: 0x1..0xffffffff или десятичное без ведущих нулей';
			var clash = otherTunnels(section_id).filter(function(t) { return parseMark(t.fwmark) === n; });
			return clash.length ? 'Метка уже занята туннелем «' + clash[0]['.name'] + '»' : true;
		};

		o = s.option(form.Value, 'table', 'Таблица маршрутизации',
			'Уникальный номер 1..252, например 101.');
		o.modalonly = true;
		o.rmempty = false;
		o.datatype = 'range(1,252)';
		o.default = String(nextFree('table', function(v) { return +v; }, 101, 252));
		o.validate = function(section_id, value) {
			if (!/^[1-9][0-9]{0,2}$/.test(String(value))) return 'Целое число 1..252 без ведущих нулей';
			var clash = otherTunnels(section_id).filter(function(t) { return +t.table === +value; });
			return clash.length ? 'Таблица уже занята туннелем «' + clash[0]['.name'] + '»' : true;
		};

		o = s.option(form.Value, 'priority', 'Приоритет',
			'91..32765. Меньше — главнее, если адрес подходит двум туннелям.');
		o.modalonly = true;
		o.rmempty = false;
		o.datatype = 'range(91,32765)';
		o.default = String(nextFree('priority', function(v) { return +v; }, 101, 32765));
		o.validate = function(section_id, value) {
			return /^[1-9][0-9]{1,4}$/.test(String(value)) ? true : 'Целое число 91..32765 без ведущих нулей';
		};

		o = s.option(form.ListValue, 'fallback', 'Запасной туннель',
			'Куда отправить трафик, если этот туннель упадёт.');
		o.modalonly = true;
		o.value('', '— напрямую через провайдера —');
		uci.sections('awgsplit', 'tunnel', function(sc) {
			o.value(sc['.name'], sc.label || sc['.name']);
		});
		o.validate = function(section_id, value) {
			return value === section_id ? 'Туннель не может быть запасным сам для себя' : true;
		};

		o = s.option(form.DynamicList, 'dns', 'DNS туннеля',
			'Через него резолвятся домены этого туннеля (запросы идут внутри туннеля, провайдер их не видит и не подменяет). ' +
			'Если пусто — берётся DNS из импортированного .conf (у серверов Amnezia это 172.29.172.254).');
		o.modalonly = true;
		o.placeholder = '172.29.172.254';
		o.validate = function(section_id, value) {
			if (!value) return true;
			return RE_IP4.test(value) ? true : 'Нужен IPv4-адрес';
		};

		o = s.option(form.MultiValue, 'community_lists', 'Готовые списки');
		COMMUNITY.forEach(function(c) { o.value(c[0], c[1]); });
		o.modalonly = true;
		o.display_size = 12;

		o = s.option(form.DynamicList, 'subnets', 'Свои подсети',
			'IPv4-адрес или подсеть, например 203.0.113.0/24 — пойдут в туннель без участия DNS. Главнее всех остальных правил.');
		o.modalonly = true;
		o.validate = function(section_id, value) {
			if (!value) return true;
			var p = String(value).split('/');
			if (p.length > 2 || !RE_IP4.test(p[0])) return 'Нужен IPv4-адрес или подсеть';
			if (p.length === 2 && !(/^\d{1,2}$/.test(p[1]) && +p[1] <= 32)) return 'Маска подсети 0..32';
			return true;
		};

		// ------------------------------------------------ свои домены
		s = m.section(form.GridSection, 'domains', 'Свои списки доменов',
			'Один домен на строку (можно через пробел или запятую), # — комментарий. ' +
			'Поддомены покрываются автоматически: example.com захватит и api.example.com.');
		s.addremove = true;
		s.anonymous = false;
		s.nodescriptions = true;
		s.addbtntitle = 'Добавить список';

		o = s.option(form.Flag, 'enabled', 'Вкл');
		o.editable = true;
		o.default = '1';
		o.rmempty = false;

		o = s.option(form.Value, 'label', 'Название списка');
		o.placeholder = 'Мой список';
		o.editable = true;

		o = s.option(form.Flag, 'killswitch', 'Kill switch',
			'Трафик этих доменов не пропускается мимо туннеля: если туннель недоступен, соединения сбрасываются, а не идут напрямую.');
		o.editable = true;
		o.default = '0';
		o.rmempty = true;

		o = s.option(form.ListValue, 'tunnel', 'В какой туннель');
		o.value('', '— не назначен —');
		var tunnelNames = {};
		uci.sections('awgsplit', 'tunnel', function(sc) {
			tunnelNames[sc['.name']] = true;
			o.value(sc['.name'], sc.label || sc['.name']);
		});
		// список, привязанный к удалённому туннелю, показываем как есть — не подменяем молча первым туннелем
		uci.sections('awgsplit', 'domains', function(sc) {
			if (sc.tunnel && !tunnelNames[sc.tunnel]) {
				tunnelNames[sc.tunnel] = true;
				o.value(sc.tunnel, sc.tunnel + ' (туннель не найден)');
			}
		});
		o.rmempty = false;
		o.validate = function(section_id, value) {
			return value ? true : 'Выберите туннель (сначала создайте его выше)';
		};

		o = s.option(form.TextValue, 'domains', 'Домены');
		o.rows = 20;
		o.wrap = 'off';
		o.modalonly = true;
		o.placeholder = 'example.com\nanother.org';
		o.validate = function(section_id, value) {
			var bad = domainTokens(value).filter(function(t) { return normDomain(t) === null; });
			if (bad.length)
				return 'Некорректные записи: ' + bad.slice(0, 3).join(', ') +
					(bad.length > 3 ? ' и ещё ' + (bad.length - 3) : '');
			return true;
		};

		o = s.option(form.DummyValue, '_count', 'Доменов');
		o.cfgvalue = function(section_id) {
			return String(domainTokens(uci.get('awgsplit', section_id, 'domains')).length);
		};

		return m.render();
	}
});
