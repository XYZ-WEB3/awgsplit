# awgsplit: fw4 include (type script) — выполняется после каждого fw4 start/reload.
# «firewall stop/restart» (fw4 flush) удаляет ВСЕ таблицы nft, в т.ч. inet awgsplit: до ближайшей
# проверки (healthcheck_interval) kill switch не действовал. Сразу ставим охрану, полные правила — в фоне.
# Файл подключается через «. path» с переопределённой функцией config(): uci-функции тут не вызывать.
if [ -f /var/run/awgsplit/started ] && ! nft list chain inet awgsplit pick >/dev/null 2>&1; then
	/usr/bin/awgsplit guard </dev/null >/dev/null 2>&1
	( /usr/bin/awgsplit routes </dev/null >/dev/null 2>&1 & )
fi
true
