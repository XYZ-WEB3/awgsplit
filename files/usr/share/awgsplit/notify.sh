# awgsplit — уведомления в Telegram о переключениях туннелей.
#
# Подключается из /usr/bin/awgsplit (". /usr/share/awgsplit/notify.sh") после config_load awgsplit.
# Никаких резидентных процессов и опросов: одно сообщение = один HTTPS POST через uclient-fetch
# (на OpenWrt wget — это он же), всегда в фоне, чтобы цикл healthcheck не ждал сеть.
#
# Функции для движка:
#   notify_event KIND GROUP FROM TO REASON "LIVE..." "DEAD..."   KIND: switch|down|up|back
#   notify_flush [-w]   отправить очередь (на каждом тике; -w — синхронно, для CLI/тестов)
#   notify_test         синхронно отправить тестовое сообщение, вывести результат по каждому chat id
#   notify_valid_config 0 — токен и chat id выглядят правильно; иначе причины в stderr
#
# Настройки (секция awgsplit.global):
#   tg_enabled '0|1'          tg_token '123456:AA...'     tg_chat_ids '111,-100222' (до 10 шт.)
#   tg_events 'switch down up back'                       tg_router_name '' (пусто = hostname)
#   tg_delay '0'  — задержка подтверждения события; её выдерживает движок, здесь не используется
#   tg_fmt_switch / tg_fmt_down / tg_fmt_up / tg_fmt_back — шаблоны, \n = перевод строки.
#   Подстановки: {router} {group} {group_label} {from} {from_label} {to} {to_label}
#                {live} {dead} {reason} {time}; неизвестные {..} остаются как есть.
#
# Очередь: $STATE_DIR/notify.queue, строка "время chat_id текст-в-urlencode" (токена там нет).
# Новые события сначала пишутся отдельными файлами в $STATE_DIR/notify.spool (атомарно, без
# блокировки), флаш под своей блокировкой забирает их в очередь. Telegram часто недоступен
# именно пока лежат туннели — сообщения ждут до 24 ч (не больше 50), повторы с растущей паузой.
#
# Токен — секрет: не пишется в лог, в файлы состояния и в вывод. Компромисс: uclient-fetch
# принимает адрес только аргументом, поэтому токен виден в argv (ps) процесса отправки на время
# запроса (не дольше 10 с). На OpenWrt один пользователь-администратор, поэтому это допустимо.

NT_TPL_SWITCH='⚠️ {router}: туннель «{from_label}» упал, переключился на «{to_label}» (группа «{group_label}»)\nРаботают: {live}\nНе работают: {dead}'
NT_TPL_DOWN='🔴 {router}: группа «{group_label}» осталась без рабочих туннелей ({reason})\nНе работают: {dead}'
NT_TPL_UP='🟢 {router}: группа «{group_label}» снова работает через «{to_label}»\nРаботают: {live}'
NT_TPL_BACK='🔁 {router}: группа «{group_label}» вернулась на основной туннель «{to_label}»\nРаботают: {live}\nНе работают: {dead}'
NT_TEST_MSG='✅ awgsplit: тестовое сообщение'

NT_QMAX=50        # максимум сообщений в очереди (лишние — самые старые — выбрасываются)
NT_TTL=86400      # старше суток не отправляем
NT_BATCH=5        # не больше отправок за один флаш
NT_MAXLEN=4000    # байт текста (Telegram режет на 4096 символах)
NT_DEDUP=600      # одинаковое событие группы повторно не шлём в течение 10 минут
NT_SEQ=0

_nt_paths() {
	: "${STATE_DIR:=/var/run/awgsplit}"
	NT_API="${AWGSPLIT_TG_API:-https://api.telegram.org}"
	NT_QUEUE="$STATE_DIR/notify.queue"
	NT_SPOOL="$STATE_DIR/notify.spool"
	NT_NEXT="$STATE_DIR/notify.next"
	NT_FAIL="$STATE_DIR/notify.fail"
	NT_LAST="$STATE_DIR/notify.last"
	NT_LOCK="$STATE_DIR/notify.lck"
}

_nt_log() { # уровень сообщение
	if [ "$(command -v log 2>/dev/null)" = log ]; then
		log "$1" "telegram: $2"
	else
		logger -t awgsplit -p "daemon.$1" "telegram: $2"
	fi
}

_nt_load() {
	config_get NT_ENABLED   global tg_enabled 0
	config_get NT_TOKEN     global tg_token ''
	config_get NT_CHATS_RAW global tg_chat_ids ''
	config_get NT_EVENTS    global tg_events 'switch down up back'
	config_get NT_ROUTER    global tg_router_name ''
}

# Проверка токена и разбор chat id -> NT_CHATS. Причины — в stderr.
_nt_check() {
	local ok=0 t="$NT_TOKEN" pre suf raw id d n=0
	NT_CHATS=''
	case "$t" in
	'') echo "Telegram: не задан токен бота" >&2; ok=1 ;;
	*[!0-9A-Za-z_:-]*) echo "Telegram: токен содержит недопустимые символы" >&2; ok=1 ;;
	*:*)
		pre="${t%%:*}"; suf="${t#*:}"
		case "$pre" in ''|*[!0-9]*) ok=1 ;; esac
		case "$suf" in *:*) ok=1 ;; esac
		[ "${#pre}" -ge 5 ] && [ "${#suf}" -ge 20 ] || ok=1
		[ "$ok" = 0 ] || echo "Telegram: токен не похож на токен бота (ожидается вида 123456789:AAH...)" >&2
		;;
	*) echo "Telegram: токен не похож на токен бота (ожидается вида 123456789:AAH...)" >&2; ok=1 ;;
	esac

	raw=$(printf '%s' "$NT_CHATS_RAW" | tr ',;\t\r\n' '     ')
	case "$raw" in
	*[!0-9\ -]*) echo "Telegram: chat id — это числа через запятую (у групп с минусом впереди)" >&2; return 1 ;;
	esac
	for id in $raw; do
		d="${id#-}"
		case "$d" in ''|*[!0-9]*) echo "Telegram: неверный chat id «$id»" >&2; ok=1; continue ;; esac
		[ "${#d}" -le 20 ] || { echo "Telegram: слишком длинный chat id «$id»" >&2; ok=1; continue; }
		case " $NT_CHATS " in *" $id "*) continue ;; esac
		n=$((n + 1))
		NT_CHATS="${NT_CHATS:+$NT_CHATS }$id"
	done
	if [ "$n" = 0 ]; then
		echo "Telegram: не задан ни один chat id" >&2; ok=1
	elif [ "$n" -gt 10 ]; then
		echo "Telegram: chat id больше 10 ($n)" >&2; ok=1
	fi
	return $ok
}

notify_valid_config() {
	_nt_paths; _nt_load
	_nt_check
}

# Безопасное имя секции UCI (config_get делает eval по имени секции)
_nt_sname() { case "$1" in ''|*[!A-Za-z0-9_]*) return 1 ;; esac; return 0; }

_nt_label() { # имя -> подпись туннеля/группы (без eval пользовательских данных)
	local l
	if _nt_sname "$1"; then config_get l "$1" label "$1"; else l="$1"; fi
	printf '%s' "${l:-$1}"
}

_nt_labels() { # "имя имя ..." -> "Подпись, Подпись"
	local n out=''
	for n in $1; do out="${out:+$out, }$(_nt_label "$n")"; done
	printf '%s' "${out:-—}"
}

_nt_router() {
	local h="$NT_ROUTER"
	[ -n "$h" ] || h=$(uci -q get 'system.@system[0].hostname' 2>/dev/null)
	[ -n "$h" ] || h=$(cat /proc/sys/kernel/hostname 2>/dev/null)
	printf '%s' "${h:-OpenWrt}"
}

# Шаблон и значения приходят через окружение (ENVIRON), а не через -v/eval/sed:
# никакие символы в подписях не интерпретируются. Один проход: подставленное значение
# повторно не разбирается. Результат обрезается до NT_MAXLEN байт по границе UTF-8 и
# кодируется для application/x-www-form-urlencoded.
_NT_AWK='
function enc(s,   i, c, o, n) {
	o = ""; n = length(s)
	for (i = 1; i <= n; i++) {
		c = substr(s, i, 1)
		if (c ~ /[A-Za-z0-9_.~-]/) o = o c
		else o = o sprintf("%%%02X", ord[c])
	}
	return o
}
BEGIN {
	for (i = 1; i < 256; i++) ord[sprintf("%c", i)] = i
	known = " router group group_label from from_label to to_label live dead reason time "
	t = ENVIRON["NT_T"]
	gsub(/\\n/, "\n", t)
	out = ""
	while ((p = index(t, "{")) > 0) {
		out = out substr(t, 1, p - 1)
		t = substr(t, p + 1)
		q = index(t, "}")
		if (q == 0) { out = out "{"; continue }
		name = substr(t, 1, q - 1)
		if (name != "" && name !~ /[^a-z_]/ && index(known, " " name " ") > 0) {
			out = out ENVIRON["NTV_" name]
			t = substr(t, q + 1)
		} else out = out "{"
	}
	out = out t
	max = ENVIRON["NT_MAX"] + 0
	if (length(out) > max) {
		n = max - 4
		while (n > 0 && (ord[substr(out, n + 1, 1)] >= 128 && ord[substr(out, n + 1, 1)] < 192)) n--
		out = substr(out, 1, n) " …"
	}
	printf "%s", enc(out)
}'

_nt_render() { # шаблон -> urlencoded текст (значения в переменных NTV_*)
	NT_T="$1" NT_MAX="$NT_MAXLEN" LC_ALL=C awk "$_NT_AWK" </dev/null
}

_nt_now() { date +%s; }
_nt_num() { case "$1" in ''|*[!0-9]*) echo "${2:-0}" ;; *) echo "$1" ;; esac; }

notify_event() {
	local kind="$1" group="$2" from="$3" to="$4" reason="$5" live="$6" dead="$7"
	local tpl now key prev enc f id
	_nt_paths; _nt_load
	[ "$NT_ENABLED" = 1 ] || return 0
	case "$kind" in switch|down|up|back) ;; *) return 0 ;; esac
	case " $(printf '%s' "$NT_EVENTS" | tr ',\t\n' '   ') " in *" $kind "*) ;; *) return 0 ;; esac
	if ! _nt_check 2>/dev/null; then
		_nt_log warn "уведомления включены, но токен или chat id заданы неверно — не отправляю"
		return 0
	fi
	mkdir -p "$STATE_DIR" 2>/dev/null
	now=$(_nt_now)

	# одно и то же событие группы подряд (двойной вызов, дребезг) — не дублируем
	key="$kind|$from|$to"
	prev=$(NTK="$group" awk -F '\t' '$1 == ENVIRON["NTK"] { print $3 "\t" $2 }' "$NT_LAST" 2>/dev/null)
	if [ "${prev#*	}" = "$key" ] && [ $((now - $(_nt_num "${prev%%	*}" 0))) -lt "$NT_DEDUP" ]; then
		_nt_log debug "повтор события $kind группы $group — пропущено"
		return 0
	fi
	{ NTK="$group" awk -F '\t' '$1 != ENVIRON["NTK"]' "$NT_LAST" 2>/dev/null
	  printf '%s\t%s\t%s\n' "$group" "$key" "$now"; } > "$NT_LAST.tmp" && mv -f "$NT_LAST.tmp" "$NT_LAST"

	case "$kind" in
	switch) config_get tpl global tg_fmt_switch "$NT_TPL_SWITCH" ;;
	down)   config_get tpl global tg_fmt_down   "$NT_TPL_DOWN" ;;
	up)     config_get tpl global tg_fmt_up     "$NT_TPL_UP" ;;
	back)   config_get tpl global tg_fmt_back   "$NT_TPL_BACK" ;;
	esac
	enc=$(
		NTV_router=$(_nt_router); NTV_group="$group"; NTV_group_label=$(_nt_label "$group")
		NTV_from="${from:-—}"; NTV_from_label='—'; [ -z "$from" ] || NTV_from_label=$(_nt_label "$from")
		NTV_to="${to:-—}"; NTV_to_label='—'; [ -z "$to" ] || NTV_to_label=$(_nt_label "$to")
		NTV_live=$(_nt_labels "$live"); NTV_dead=$(_nt_labels "$dead")
		NTV_reason="${reason:-—}"; NTV_time=$(date '+%d.%m.%Y %H:%M:%S')
		export NTV_router NTV_group NTV_group_label NTV_from NTV_from_label NTV_to NTV_to_label \
			NTV_live NTV_dead NTV_reason NTV_time
		_nt_render "$tpl"
	)
	[ -n "$enc" ] || return 0

	NT_SEQ=$((NT_SEQ + 1))
	mkdir -p "$NT_SPOOL" 2>/dev/null
	f="$NT_SPOOL/$now.$$.$NT_SEQ"
	for id in $NT_CHATS; do printf '%s %s %s\n' "$now" "$id" "$enc"; done > "$f.tmp" &&
		mv -f "$f.tmp" "$f.msg"
	_nt_log info "событие $kind группы $group поставлено в очередь"
	notify_flush
}

_nt_lock() {
	local pid me age
	me=$(exec sh -c 'echo $PPID')  # $$ в подоболочке — pid родителя, нужен свой
	if mkdir "$NT_LOCK" 2>/dev/null; then echo "$me" > "$NT_LOCK/pid"; return 0; fi
	pid=$(cat "$NT_LOCK/pid" 2>/dev/null)
	age=$(( $(_nt_now) - $(_nt_num "$(date -r "$NT_LOCK" +%s 2>/dev/null)" 0) ))
	if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null && [ "$age" -lt 300 ]; then return 1; fi
	rm -rf "$NT_LOCK"
	mkdir "$NT_LOCK" 2>/dev/null || return 1
	echo "$me" > "$NT_LOCK/pid"
}

_nt_unlock() { rm -rf "$NT_LOCK"; }

# Отправка: chat_id urlencoded-текст -> NT_RES: ok | net | NNN (HTTP-код)
_nt_send() {
	local out rc code fetch=uclient-fetch
	command -v uclient-fetch >/dev/null 2>&1 || fetch=wget
	# без -q, чтобы получить HTTP-код; вывод содержит адрес с токеном — он только
	# разбирается здесь и никуда не пишется
	out=$("$fetch" -T 10 -O - --post-data "chat_id=$1&text=$2" "$NT_API/bot$NT_TOKEN/sendMessage" 2>&1 </dev/null)
	rc=$?
	code=$(printf '%s\n' "$out" | sed -n 's/.*HTTP error \([0-9][0-9][0-9]\).*/\1/p; s/.*ERROR \([0-9][0-9][0-9]\).*/\1/p' | head -n 1)
	case "$out" in *'"ok":true'*) [ "$rc" = 0 ] && code=ok ;; esac
	out=''
	if [ -n "$code" ]; then NT_RES=$code
	elif [ "$rc" = 0 ]; then NT_RES=000   # ответ без "ok":true — странный, считаем временной ошибкой
	else NT_RES=net
	fi
}

_nt_why() { # NT_RES -> причина по-русски
	case "$1" in
	ok)  echo "ok" ;;
	net) echo "Telegram недоступен (нет связи с сервером API)" ;;
	401|404) echo "HTTP $1: неверный токен бота" ;;
	400) echo "HTTP 400: чат не найден — пользователь должен сначала нажать /start у бота (или неверный chat id)" ;;
	403) echo "HTTP 403: бот не может писать этому пользователю — пользователь должен сначала нажать /start у бота (или он заблокировал бота)" ;;
	429) echo "HTTP 429: слишком много сообщений, Telegram просит подождать" ;;
	000) echo "непонятный ответ Telegram" ;;
	*)   echo "HTTP $1: ошибка Telegram" ;;
	esac
}

# Забрать spool в очередь, выбросить старое, дубли и лишнее сверх NT_QMAX
_nt_ingest() { # now
	local f
	for f in "$NT_SPOOL"/*.msg; do
		[ -f "$f" ] || continue
		cat "$f" >> "$NT_QUEUE" && rm -f "$f"
	done
	[ -f "$NT_QUEUE" ] || return 0
	awk -v now="$1" -v ttl="$NT_TTL" -v max="$NT_QMAX" '
		NF == 3 && $1 + 0 >= now - ttl && !(($2 " " $3) in seen) { seen[$2 " " $3] = 1; l[++n] = $0 }
		END { for (i = (n > max ? n - max + 1 : 1); i <= n; i++) print l[i] }
	' "$NT_QUEUE" > "$NT_QUEUE.tmp" && mv -f "$NT_QUEUE.tmp" "$NT_QUEUE"
	[ -s "$NT_QUEUE" ] || rm -f "$NT_QUEUE"
}

_nt_flush() {
	local now next fails delay i sent=0 ts chat enc drop=0
	_nt_lock || return 0
	now=$(_nt_now)
	_nt_ingest "$now"
	next=$(_nt_num "$(cat "$NT_NEXT" 2>/dev/null)" 0)
	if [ ! -s "$NT_QUEUE" ] || [ "$now" -lt "$next" ]; then _nt_unlock; return 0; fi

	while [ "$sent" -lt "$NT_BATCH" ] && IFS=' ' read -r ts chat enc; do
		_nt_send "$chat" "$enc"
		case "$NT_RES" in
		ok) ;;
		400|403) _nt_log warn "chat $chat: $(_nt_why "$NT_RES") — сообщение выброшено" ;;
		401|404)
			_nt_log error "$(_nt_why "$NT_RES") — очередь уведомлений очищена"
			drop=1; break ;;
		*)
			fails=$(( $(_nt_num "$(cat "$NT_FAIL" 2>/dev/null)" 0) + 1 ))
			delay=60; i=1
			while [ "$i" -lt "$fails" ] && [ "$delay" -lt 1800 ]; do delay=$((delay * 2)); i=$((i + 1)); done
			[ "$delay" -le 1800 ] || delay=1800
			echo "$fails" > "$NT_FAIL"
			echo $(( $(_nt_now) + delay )) > "$NT_NEXT"
			[ "$fails" = 1 ] && _nt_log info "$(_nt_why "$NT_RES"); уведомления ждут в очереди"
			_nt_log debug "повтор через ${delay} с (попытка $fails)"
			break ;;
		esac
		sent=$((sent + 1))
		rm -f "$NT_FAIL" "$NT_NEXT"
	done < "$NT_QUEUE"

	if [ "$drop" = 1 ]; then
		rm -f "$NT_QUEUE"
	elif [ "$sent" -gt 0 ]; then
		awk -v k="$sent" 'NR > k' "$NT_QUEUE" > "$NT_QUEUE.tmp" && mv -f "$NT_QUEUE.tmp" "$NT_QUEUE"
		[ -s "$NT_QUEUE" ] || rm -f "$NT_QUEUE"
	fi
	_nt_unlock
}

# Вызывается на каждом тике: без очереди — мгновенный выход, отправка — в фоне.
notify_flush() {
	_nt_paths
	[ -s "$NT_QUEUE" ] || ls "$NT_SPOOL"/*.msg >/dev/null 2>&1 || return 0
	_nt_load
	if [ "$NT_ENABLED" != 1 ] || ! _nt_check 2>/dev/null; then
		rm -rf "$NT_QUEUE" "$NT_SPOOL" "$NT_NEXT" "$NT_FAIL"
		return 0
	fi
	if [ "$1" = -w ]; then
		_nt_flush
	else
		# фон: снять ловушки движка (иначе выход подоболочки снимет его блокировку)
		( trap - EXIT HUP INT TERM; _nt_flush ) </dev/null >/dev/null 2>&1 &
	fi
	return 0
}

notify_test() {
	local id enc fail=0 n=0
	_nt_paths; _nt_load
	_nt_check || return 2
	enc=$(_nt_render "$NT_TEST_MSG")
	for id in $NT_CHATS; do
		_nt_send "$id" "$enc"
		echo "chat $id: $(_nt_why "$NT_RES")"
		[ "$NT_RES" = ok ] && n=$((n + 1)) || fail=1
	done
	if [ "$fail" = 0 ]; then
		_nt_log info "тестовое сообщение отправлено ($n)"
	else
		_nt_log warn "тестовое сообщение: не во все чаты"
	fi
	return $fail
}
