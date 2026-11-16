'use strict';
'require view';
'require ui';
'require uci';
'require dom';
'require view.awgsplit.common as awg';

var txt = awg.txt;
var CONF = awg.CONF;
var G = 'global';

var EVENTS = [
	[ 'switch', 'Переключение туннеля', 'группа перешла на другой туннель (например, основной упал — включился запасной)' ],
	[ 'down',   'Связи нет',            'в группе не осталось ни одного работающего туннеля' ],
	[ 'up',     'Связь вернулась',      'группа снова работает после полного обрыва' ],
	[ 'back',   'Возврат на основной',  'группа вернулась на основной туннель' ]
];

// Стандартные тексты: используются, когда поле шаблона пустое. Должны совпадать с текстами по умолчанию в службе.
var DEFAULT_FMT = {
	'switch': '⚠️ {router}: туннель «{from_label}» упал, переключился на «{to_label}» (группа «{group_label}»)\nРаботают: {live}\nНе работают: {dead}',
	'down':   '🔴 {router}: группа «{group_label}» осталась без рабочих туннелей ({reason})\nНе работают: {dead}',
	'up':     '🟢 {router}: группа «{group_label}» снова работает через «{to_label}»\nРаботают: {live}',
	'back':   '🔁 {router}: группа «{group_label}» вернулась на основной туннель «{to_label}»\nРаботают: {live}\nНе работают: {dead}'
};

var PLACEHOLDERS = [
	[ '{router}', 'название роутера' ],
	[ '{group_label}', 'название группы' ],
	[ '{group}', 'id группы' ],
	[ '{from_label}', 'с какого туннеля' ],
	[ '{from}', 'id туннеля «откуда»' ],
	[ '{to_label}', 'на какой туннель' ],
	[ '{to}', 'id туннеля «куда»' ],
	[ '{live}', 'какие туннели работают' ],
	[ '{dead}', 'какие не работают' ],
	[ '{reason}', 'причина' ],
	[ '{time}', 'дата и время' ]
];

function pad(n) { return (n < 10 ? '0' : '') + n; }
function nowStr() {
	var d = new Date();
	return pad(d.getDate()) + '.' + pad(d.getMonth() + 1) + '.' + d.getFullYear() + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
}

function sample(ev, router) {
	var s = {
		router: router || 'Роутер', group: 'us', group_label: 'США',
		from: 'us1', from_label: 'США #1', to: 'us2', to_label: 'США #2',
		live: 'США #2', dead: 'США #1', reason: 'нет рукопожатия 3 мин', time: nowStr()
	};
	if (ev === 'down') { s.to = ''; s.to_label = '—'; s.live = '—'; s.dead = 'США #1, США #2'; }
	if (ev === 'up') { s.from = ''; s.from_label = '—'; s.to = 'us1'; s.to_label = 'США #1'; s.live = 'США #1'; s.dead = 'США #2'; s.reason = 'туннель снова отвечает'; }
	if (ev === 'back') { s.from = 'us2'; s.from_label = 'США #2'; s.to = 'us1'; s.to_label = 'США #1'; s.live = 'США #1, США #2'; s.dead = '—'; s.reason = 'основной стабилен 2 мин'; }
	return s;
}

function render(tpl, vals) {
	return String(tpl).replace(/\\n/g, '\n').replace(/\{([a-z_]+)\}/g, function(m, k) {
		return Object.prototype.hasOwnProperty.call(vals, k) ? vals[k] : m;
	});
}

// в uci шаблон — одна строка, перевод строки записывается как \n
function fromUci(v) { return String(v || '').replace(/\\n/g, '\n'); }
function toUci(v) { return String(v || '').replace(/\r?\n/g, '\\n'); }

function validChatIds(v) {
	var ids = String(v || '').split(',').map(function(x) { return x.trim(); }).filter(function(x) { return x.length; });
	if (ids.length > 10) return 'Не больше 10 получателей';
	var bad = ids.filter(function(x) { return !/^-?\d{1,20}$/.test(x); });
	return bad.length ? 'ID — это число (у групп — с минусом впереди): ' + bad.slice(0, 3).join(', ') : true;
}

return view.extend(Object.assign({
	load: function() {
		return uci.load(CONF);
	},

	render: function() {
		if (!uci.get(CONF, G)) uci.add(CONF, 'awgsplit', G);
		this.marker = awg.dirtyMarker();
		this.body = E('div');
		this.draw();
		return awg.page('Уведомления в Telegram', 'Роутер напишет вам в Telegram, когда VPN-туннель упадёт, переключится на запасной или вернётся.', [
			this.howto(),
			this.marker.node,
			this.body
		]);
	},

	changed: function() { this.marker.mark(); },

	howto: function() {
		return awg.card('Как подключить (3 минуты)', [
			E('ol', { 'class': 'awg-steps' }, [
				E('li', {}, [ E('span', {}, txt('В Telegram откройте ')), E('strong', {}, txt('@BotFather')),
					E('span', {}, txt(', отправьте /newbot и придумайте боту имя. В ответ придёт токен вида 123456789:AAH… — вставьте его в поле «Токен бота».')) ]),
				E('li', {}, [ E('span', {}, txt('Откройте своего нового бота и нажмите ')), E('strong', {}, txt('«Запустить» (/start)')),
					E('span', {}, txt('. Без этого бот не сможет вам писать. Так должен сделать каждый, кто будет получать сообщения.')) ]),
				E('li', {}, [ E('span', {}, txt('Узнайте свой ID: напишите боту ')), E('strong', {}, txt('@userinfobot')),
					E('span', {}, txt(' — он ответит числом (Id). Впишите его в «Кому отправлять». Несколько человек — через запятую.')) ]),
				E('li', {}, txt('Нажмите «Сохранить и применить» внизу страницы, затем «Отправить тестовое сообщение».'))
			])
		]);
	},

	draw: function() {
		this.checks = [];
		this.previews = {};
		dom.content(this.body, [ this.settingsCard(), this.templatesCard(), this.testCard() ]);
	},

	opt: function(name) { return uci.get(CONF, G, name); },

	settingsCard: function() {
		var self = this;

		var en = awg.checkbox('Включить уведомления', this.opt('tg_enabled') === '1', function(v) {
			uci.set(CONF, G, 'tg_enabled', v ? '1' : '0'); self.changed(); awg.runChecks(self.checks);
		});

		var token = E('input', { 'type': 'password', 'class': 'cbi-input-text', 'value': this.opt('tg_token') || '', 'autocomplete': 'off',
			'spellcheck': 'false', 'placeholder': '123456789:AAH…', 'style': 'flex:1 1 18em;min-width:0' });
		var show = E('button', { 'type': 'button', 'class': 'btn cbi-button-neutral', 'aria-label': 'Показать или скрыть токен' }, txt('👁 Показать'));
		show.addEventListener('click', function() {
			var hidden = token.type === 'password';
			token.type = hidden ? 'text' : 'password';
			dom.content(show, txt(hidden ? '🙈 Скрыть' : '👁 Показать'));
		});
		var tErr = awg.bindField(this.checks, token, {
			name: 'Токен бота',
			validate: function(v) {
				v = String(v).trim();
				if (!v) return self.opt('tg_enabled') === '1' ? 'Нужен токен от @BotFather' : true;
				return /^\d{5,20}:[A-Za-z0-9_-]{20,}$/.test(v) ? true : 'Не похоже на токен: должно быть «число:длинная строка»';
			},
			set: function(v) { awg.setOpt(G, 'tg_token', v.trim()); self.changed(); }
		});

		var ids = E('input', { 'type': 'text', 'class': 'cbi-input-text', 'value': this.opt('tg_chat_ids') || '', 'placeholder': '123456789, 987654321',
			'inputmode': 'numeric' });
		var iErr = awg.bindField(this.checks, ids, {
			name: 'Кому отправлять',
			validate: function(v) {
				if (!String(v).trim()) return self.opt('tg_enabled') === '1' ? 'Впишите хотя бы один ID' : true;
				return validChatIds(v);
			},
			set: function(v) {
				awg.setOpt(G, 'tg_chat_ids', String(v).split(',').map(function(x) { return x.trim(); }).filter(function(x) { return x; }).join(','));
				self.changed();
			}
		});

		var evRaw = this.opt('tg_events');
		var evs = evRaw == null ? EVENTS.map(function(e) { return e[0]; }) : String(evRaw).split(/[\s,]+/).filter(function(x) { return x; });
		var evBoxes = EVENTS.map(function(e) {
			return awg.checkbox(e[1], evs.indexOf(e[0]) >= 0, function(on) {
				var cur = (self.opt('tg_events') == null ? EVENTS.map(function(x) { return x[0]; }) :
					String(self.opt('tg_events')).split(/[\s,]+/)).filter(function(x) { return x && x !== e[0] && x !== 'none'; });
				if (on) cur.push(e[0]);
				var ordered = EVENTS.map(function(x) { return x[0]; }).filter(function(x) { return cur.indexOf(x) >= 0; });
				// пустое значение служба поняла бы как «все события», поэтому «ничего» записывается словом none
				uci.set(CONF, G, 'tg_events', ordered.length ? ordered.join(' ') : 'none');
				self.changed();
			}, e[2]);
		});

		var delay = E('input', { 'type': 'number', 'min': '0', 'max': '3600', 'class': 'cbi-input-text', 'style': 'width:8em',
			'value': this.opt('tg_delay') || '', 'placeholder': '0' });
		var dErr = awg.bindField(this.checks, delay, {
			name: 'Задержка',
			validate: function(v) { return (!v || (/^\d+$/.test(v) && +v <= 3600)) ? true : 'Число секунд от 0 до 3600'; },
			set: function(v) { awg.setOpt(G, 'tg_delay', String(v).trim()); self.changed(); }
		});

		var router = E('input', { 'type': 'text', 'class': 'cbi-input-text', 'value': this.opt('tg_router_name') || '', 'placeholder': 'например, Дача', 'maxlength': '40' });
		awg.bindField(this.checks, router, {
			set: function(v) { awg.setOpt(G, 'tg_router_name', v.trim()); self.changed(); self.updatePreviews(); }
		});

		return awg.card('Настройки', [
			E('div', { 'class': 'awg-field' }, [ en ]),
			E('div', { 'class': 'awg-field' }, [
				E('label', { 'for': token.id = awg.fid() }, txt('Токен бота')),
				E('div', { 'class': 'awg-btns' }, [ token, show ]),
				tErr,
				E('div', { 'class': 'awg-muted awg-small' }, txt('Выдаёт @BotFather. Это секрет: с ним кто угодно сможет писать от имени бота.'))
			]),
			awg.field('Кому отправлять (ID через запятую)', ids, 'До 10 получателей. Свой ID подскажет @userinfobot. ID группового чата начинается с минуса.', iErr),
			E('div', { 'class': 'awg-field' }, [ E('label', {}, txt('О чём сообщать')), E('div', { 'class': 'awg-checks' }, evBoxes) ]),
			E('div', { 'class': 'awg-fields' }, [
				awg.field('Подождать перед отправкой, сек', delay, '0 — сразу. Если проблема исчезнет быстрее, сообщение не придёт — так короткие сбои не будут беспокоить.', dErr),
				awg.field('Название роутера в сообщениях', router, 'Пригодится, если роутеров несколько. Пусто — имя хоста роутера.')
			])
		]);
	},

	extraChecks: function() {
		var ev = String(this.opt('tg_events') == null ? 'switch' : this.opt('tg_events')).split(/[\s,]+/)
			.filter(function(x) { return EVENTS.some(function(e) { return e[0] === x; }); });
		return (this.opt('tg_enabled') === '1' && !ev.length) ? [ 'Уведомления включены, но не выбрано ни одного события' ] : [];
	},

	updatePreviews: function() {
		var self = this;
		var router = this.opt('tg_router_name');
		Object.keys(this.previews).forEach(function(ev) {
			var tpl = fromUci(self.opt('tg_fmt_' + ev)) || DEFAULT_FMT[ev];
			dom.content(self.previews[ev], txt(render(tpl, sample(ev, router))));
		});
	},

	templatesCard: function() {
		var self = this;

		var legend = E('div', { 'class': 'awg-row' }, PLACEHOLDERS.map(function(p) {
			var b = E('button', { 'type': 'button', 'class': 'btn cbi-button-neutral awg-ph', 'title': 'Вставить в шаблон: ' + p[1] }, txt(p[0]));
			b.addEventListener('mousedown', function(ev) { ev.preventDefault(); });
			b.addEventListener('click', function() {
				var ta = self.lastTa;
				if (!ta) { awg.note('Сначала щёлкните в поле шаблона, куда вставить ' + p[0] + '.', 'info'); return; }
				var a = ta.selectionStart || 0, z = ta.selectionEnd || 0;
				ta.value = ta.value.slice(0, a) + p[0] + ta.value.slice(z);
				ta.selectionStart = ta.selectionEnd = a + p[0].length;
				ta.focus();
				ta.dispatchEvent(new Event('input'));
			});
			return E('span', { 'class': 'awg-small' }, [ b, E('span', { 'class': 'awg-muted' }, txt(' ' + p[1])) ]);
		}));

		var blocks = EVENTS.map(function(e) {
			var ev = e[0];
			var ta = E('textarea', { 'rows': '5', 'class': 'cbi-input-textarea', 'placeholder': DEFAULT_FMT[ev], 'spellcheck': 'false',
				'aria-label': 'Шаблон: ' + e[1] }, txt(fromUci(self.opt('tg_fmt_' + ev))));
			ta.addEventListener('focus', function() { self.lastTa = ta; });
			awg.bindField(self.checks, ta, {
				set: function(v) { awg.setOpt(G, 'tg_fmt_' + ev, toUci(v)); self.changed(); self.updatePreviews(); }
			});
			var prev = E('div', { 'class': 'awg-bubble', 'aria-label': 'Предпросмотр' });
			self.previews[ev] = prev;
			var reset = E('button', { 'type': 'button', 'class': 'btn cbi-button-neutral' }, txt('Стандартный текст'));
			reset.addEventListener('click', function() { ta.value = ''; ta.dispatchEvent(new Event('input')); });
			return E('div', { 'class': 'awg-panel awg-s-info' }, [
				E('div', { 'class': 'awg-head' }, [ E('h4', {}, txt(e[1])), reset ]),
				E('div', { 'class': 'awg-grid' }, [
					E('div', {}, [ ta, E('div', { 'class': 'awg-muted awg-small' }, txt('Пусто — стандартный текст (виден серым). Enter — новая строка.')) ]),
					E('div', {}, [ E('div', { 'class': 'awg-muted awg-small', 'style': 'margin-bottom:4px' }, txt('Так будет выглядеть (пример):')), prev ])
				])
			]);
		});

		var card = awg.card('Тексты сообщений', [
			awg.muted('Подстановки в фигурных скобках заменяются настоящими значениями. Щёлкните по подстановке — она вставится туда, где стоит курсор.'),
			legend
		].concat(blocks));
		this.updatePreviews();
		return card;
	},

	testCard: function() {
		var self = this;
		var out = E('div');
		return awg.card('Проверка', [
			E('p', {}, txt('Бот отправит пробное сообщение всем получателям. Проверяются сохранённые и применённые настройки — ' +
				'поэтому сначала нажмите «Сохранить и применить».')),
			E('div', { 'class': 'awg-btns' }, [
				awg.button('✉ Отправить тестовое сообщение', 'cbi-button-action', function() { return self.test(out); })
			]),
			out
		]);
	},

	test: function(out) {
		if (this.marker.dirty) {
			dom.content(out, awg.banner('warn', 'Есть несохранённые изменения',
				'Нажмите «Сохранить и применить» внизу страницы и повторите проверку — иначе бот возьмёт старые настройки.'));
			return;
		}
		dom.content(out, E('p', { 'class': 'spinning' }, txt('Отправляю…')));
		return Promise.resolve(uci.changes ? uci.changes().catch(function() { return {}; }) : {}).then(function(ch) {
			if (ch && Array.isArray(ch[CONF]) && ch[CONF].length) {
				dom.content(out, awg.banner('warn', 'Изменения сохранены, но не применены',
					'Нажмите «Сохранить и применить» (или примените изменения в шапке страницы) и повторите проверку.'));
				return;
			}
			return awg.callTestNotify().then(function(res) {
				var ok = res && (res.ok === true || res.ok === 1 || res.ok === '1');
				dom.content(out, [
					ok ? awg.banner('ok', '✔ Отправлено — проверьте Telegram', 'Если сообщение не пришло, убедитесь, что каждый получатель нажал «Запустить» в боте.') :
						awg.banner('bad', '✕ Не получилось отправить', 'Проверьте токен и ID, и что роутер выходит в интернет. Подробности ниже.'),
					res && res.output ? E('pre', { 'class': 'awg-pre' }, txt(res.output)) : ''
				]);
			});
		}).catch(function(e) {
			dom.content(out, awg.banner('bad', 'Ошибка вызова', String(e && e.message ? e.message : e)));
		});
	}
}, awg.saveHandlers('draw')));
