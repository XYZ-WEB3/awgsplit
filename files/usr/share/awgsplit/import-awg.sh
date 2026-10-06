#!/bin/sh
# import-awg.sh <файл.conf> <имя_интерфейса>
#
# Разбирает конфиг AmneziaVPN (AmneziaWG 1.x/2.x/3.x) и создаёт интерфейс
# OpenWrt. Основной бэкенд — пакеты 2Grey/awg-openwrt: proto=amneziawg,
# опции с префиксом awg_. Запасной — proto=amneziawg3 (опции без префикса).
#
# Всё проверяется ДО записи в UCI: если что-то не так, конфиг роутера не меняется.
#
# route_allowed_ips принудительно = 0: маршрутами занимается awgsplit.
# Иначе AllowedIPs = 0.0.0.0/0 увело бы в туннель ВЕСЬ трафик.
#
# Коды выхода: 0 ок, 1 ошибка в конфиге, 2 нет AmneziaWG, 3 бэкенд не
# поддерживает поля конфига, 4 недопустимое имя интерфейса.

CONF="$1"
IFACE="${2:-awg_main}"
TAB=$(printf '\t')

die() { local c="$1"; shift; echo "ОШИБКА: $*"; cleanup; exit "$c"; }
cleanup() {
	[ -n "$PARSED" ] && rm -f "$PARSED" "$OPTS"
	[ -n "$SAVEDIR" ] && rm -rf "$SAVEDIR"
	return 0
}

[ -f "$CONF" ] || die 1 "файл '$CONF' не найден"

# ---------------------------------------------------------------- имя интерфейса
case "$IFACE" in
	''|[!A-Za-z]*|*[!A-Za-z0-9_]*)
		die 4 "имя интерфейса '$IFACE' недопустимо: латиница, цифры и _, начинается с буквы (например awg_main)" ;;
esac
[ ${#IFACE} -le 15 ] || die 4 "имя интерфейса длиннее 15 символов — так нельзя назвать сетевое устройство"
case "$IFACE" in
	lan|wan|wan6|loopback|lo|globals|awgsplit) die 4 "имя '$IFACE' зарезервировано, выбери другое" ;;
esac

stype=$(uci -q get network."$IFACE")
if [ -n "$stype" ]; then
	[ "$stype" = interface ] || die 4 "в /etc/config/network уже есть секция '$IFACE' другого типа ($stype)"
	sproto=$(uci -q get network."$IFACE".proto)
	case "$sproto" in
		amneziawg|amneziawg3|'') ;;
		*) die 4 "интерфейс '$IFACE' уже существует (proto=$sproto) — выбери другое имя, чтобы его не затереть" ;;
	esac
elif [ -e "/sys/class/net/$IFACE" ]; then
	die 4 "в системе уже есть сетевое устройство '$IFACE' — выбери другое имя"
fi

# ---------------------------------------------------------------- бэкенд
if [ -f /lib/netifd/proto/amneziawg.sh ]; then
	PROTO=amneziawg; PFX=awg_; H=/lib/netifd/proto/amneziawg.sh
elif [ -f /lib/netifd/proto/amneziawg3.sh ]; then
	PROTO=amneziawg3; PFX=; H=/lib/netifd/proto/amneziawg3.sh
else
	echo "ОШИБКА: AmneziaWG не установлен. Поставь пакеты (нужен интернет на роутере):"
	echo "  . /etc/openwrt_release; mkdir -p /etc/apk/keys"
	echo "  wget -O /etc/apk/keys/awg-openwrt-feed.pem https://2grey.github.io/awg-openwrt/keys/awg-openwrt-feed.pem"
	echo "  echo \"https://2grey.github.io/awg-openwrt/\${DISTRIB_RELEASE}/\${DISTRIB_TARGET}/packages.adb\" >> /etc/apk/repositories.d/customfeeds.list"
	echo "  apk update && apk add kmod-amneziawg amneziawg-tools luci-proto-amneziawg luci-i18n-amneziawg-ru"
	echo "  reboot"
	exit 2
fi

# ---------------------------------------------------------------- разбор .conf
PARSED=$(mktemp /tmp/awgimport.XXXXXX) || die 1 "не смог создать временный файл"
OPTS="$PARSED.opts"
: > "$OPTS"

awk -v bom="$(printf '\357\273\277')" '
	{ sub(/\r$/, "") }
	NR == 1 && index($0, bom) == 1 { $0 = substr($0, length(bom) + 1) }
	/^[ \t]*[#;]/ || /^[ \t]*$/ { next }
	/^[ \t]*\[/ {
		s = $0; sub(/^[ \t]*\[/, "", s); sub(/\].*$/, "", s); gsub(/[ \t]/, "", s); s = tolower(s)
		if (s == "interface") { sec = "i"; ni++ }
		else if (s == "peer") { sec = "p"; np++ }
		else sec = "x"
		next
	}
	{
		eq = index($0, "="); if (!eq) next
		k = substr($0, 1, eq - 1); v = substr($0, eq + 1)
		gsub(/^[ \t]+|[ \t]+$/, "", k); gsub(/^[ \t]+|[ \t]+$/, "", v)
		if (sec == "i" || sec == "p") print sec "\t" tolower(k) "\t" v
	}
	END { print "n\tcount\t" ni + 0 " " np + 0 }' "$CONF" > "$PARSED"

is_int()   { case "$1" in ''|*[!0-9]*) return 1 ;; esac; [ ${#1} -le 10 ]; }
is_range() { case "$1" in ''|-*|*-|*[!0-9-]*|*-*-*) return 1 ;; esac; [ ${#1} -le 21 ]; }
is_key()   { echo "$1" | grep -qE '^[A-Za-z0-9+/]{43}=$'; }
is_addr()  { echo "$1" | grep -qE '^[0-9A-Fa-f:.]+(/[0-9]{1,3})?$'; }
is_ip4()   { echo "$1" | awk -F. 'NF != 4 { exit 1 } { for (i = 1; i <= 4; i++) if ($i !~ /^[0-9]+$/ || length($i) > 3 || $i + 0 > 255) exit 1 }'; }
to_bool()  {
	case "$(echo "$1" | tr 'A-Z' 'a-z')" in
		on|true|yes|1) echo 1 ;;
		off|false|no|0) echo 0 ;;
		*) return 1 ;;
	esac
}
trim_list() { echo "$1" | tr ',' '\n' | sed 's/^[[:space:]]*//; s/[[:space:]]*$//' | grep -v '^$'; }

opt() { printf '%s\t%s\n' "$1" "$2" >> "$OPTS"; }   # имя опции без префикса, значение

addr=""; dns=""; privkey=""; mtu=""
pubkey=""; psk=""; allowed=""; endpoint=""; keepalive=""
ignored=""; counts=""

while IFS="$TAB" read -r sec key val; do
	case "$sec:$key" in
		n:count) counts="$val"; continue ;;
		i:address)    addr="$val" ;;
		i:dns)        dns="$val" ;;
		i:privatekey) privkey="$val" ;;
		i:mtu)        mtu="$val" ;;
		i:jc|i:jmin|i:jmax|i:s1|i:s2|i:s3|i:s4)
			is_int "$val" || die 1 "поле $key = '$val' должно быть целым числом"
			opt "$key" "$val" ;;
		i:h1|i:h2|i:h3|i:h4)
			is_range "$val" || die 1 "поле $key = '$val' должно быть числом или диапазоном вида 100-200"
			opt "$key" "$val" ;;
		i:i1|i:i2|i:i3|i:i4|i:i5)
			[ -n "$val" ] && opt "$key" "$val" ;;
		i:headerprotectionkey)
			is_key "$val" || die 1 "HeaderProtectionKey не похож на ключ (base64, 44 символа)"
			opt header_protection_key "$val" ;;
		i:contentpaddingaddition|i:rekeyaftertime|i:rekeytimeout|i:rejectaftertime|i:keepalivetimeout|i:maxhandshakeattempts)
			is_range "$val" || die 1 "поле $key = '$val' должно быть числом или диапазоном вида 100-120"
			case "$key" in
				contentpaddingaddition) opt content_padding_addition "$val" ;;
				rekeyaftertime)         opt rekey_after_time "$val" ;;
				rekeytimeout)           opt rekey_timeout "$val" ;;
				rejectaftertime)        opt reject_after_time "$val" ;;
				keepalivetimeout)       opt keepalive_timeout "$val" ;;
				maxhandshakeattempts)   opt max_handshake_attempts "$val" ;;
			esac ;;
		i:randomtrailers|i:disablecookies)
			b=$(to_bool "$val") || die 1 "поле $key = '$val' должно быть on или off"
			case "$key" in
				randomtrailers) opt random_trailers "$b" ;;
				disablecookies) opt disable_cookies "$b" ;;
			esac ;;
		p:publickey)           pubkey="$val" ;;
		p:presharedkey)        psk="$val" ;;
		p:allowedips)          allowed="$val" ;;
		p:endpoint)            endpoint="$val" ;;
		p:persistentkeepalive) keepalive="$val" ;;
		*) ignored="$ignored $key" ;;
	esac
done < "$PARSED"

set -- $counts
[ "${1:-0}" = 1 ] || die 1 "в конфиге должна быть ровно одна секция [Interface] — вставь .conf целиком"
[ "${2:-0}" = 1 ] || die 1 "в конфиге должна быть ровно одна секция [Peer] (найдено: ${2:-0})"

is_key "$privkey" || die 1 "нет PrivateKey или он не похож на ключ"
is_key "$pubkey"  || die 1 "нет PublicKey пира или он не похож на ключ"
[ -z "$psk" ] || is_key "$psk" || die 1 "PresharedKey не похож на ключ"
[ -n "$addr" ]     || die 1 "нет Address"
[ -n "$endpoint" ] || die 1 "нет Endpoint"

ADDRS=$(trim_list "$addr")
for a in $ADDRS; do is_addr "$a" || die 1 "неверный адрес в Address: '$a'"; done

ALLOWED=$(trim_list "${allowed:-0.0.0.0/0}")
for a in $ALLOWED; do is_addr "$a" || die 1 "неверная запись в AllowedIPs: '$a'"; done
WARN=""
echo "$ALLOWED" | grep -qx '0.0.0.0/0' || WARN="$WARN
  ! AllowedIPs не содержит 0.0.0.0/0 — сайты вне этих адресов через туннель не пойдут"

case "$endpoint" in
	\[*\]:*) ep_host="${endpoint%%\]*}"; ep_host="${ep_host#\[}"; ep_port="${endpoint##*\]:}" ;;
	*:*:*)   die 1 "IPv6-адрес в Endpoint нужно писать в скобках: [адрес]:порт" ;;
	*:*)     ep_host="${endpoint%:*}"; ep_port="${endpoint##*:}" ;;
	*)       die 1 "в Endpoint нет порта (нужно адрес:порт)" ;;
esac
case "$ep_host" in ''|*[!A-Za-z0-9.:_-]*) die 1 "неверный адрес сервера в Endpoint" ;; esac
is_int "$ep_port" && [ "$ep_port" -ge 1 ] && [ "$ep_port" -le 65535 ] || die 1 "неверный порт в Endpoint: '$ep_port'"

case "$keepalive" in
	''|0|off) keepalive="" ;;
	*) is_range "$keepalive" || die 1 "PersistentKeepalive = '$keepalive' — нужно число или диапазон вида 25-35" ;;
esac

if [ -n "$mtu" ]; then
	if ! is_int "$mtu" || [ "$mtu" -lt 1280 ] || [ "$mtu" -gt 1500 ]; then
		WARN="$WARN
  ! MTU = '$mtu' вне 1280..1500 — ставлю 1376"
		mtu=1376
	fi
else
	mtu=1376   # как у клиента AmneziaVPN
fi

DNS4=""
for d in $(trim_list "$dns"); do
	if is_ip4 "$d"; then DNS4="$DNS4 $d"; else WARN="$WARN
  ! DNS '$d' пропущен (поддерживается только IPv4)"; fi
done
DNS4="${DNS4# }"

# ---------------------------------------------------------------- поддерживает ли бэкенд все поля
unsupported=""
while IFS="$TAB" read -r name val; do
	grep -q "\"${PFX}${name}\"" "$H" || unsupported="$unsupported $name"
done < "$OPTS"
if [ -n "$unsupported" ]; then
	echo "ОШИБКА: установленный $PROTO не знает полей:$unsupported"
	echo "Без них туннель не совпадёт с сервером. Обнови пакеты AmneziaWG:"
	echo "  apk update && apk upgrade kmod-amneziawg amneziawg-tools luci-proto-amneziawg"
	cleanup
	exit 3
fi

# ---------------------------------------------------------------- запись в UCI
# uci commit применяет ВСЕ неприменённые правки из /tmp/.uci (их не отделить даже через -t),
# а network reload включил бы их без отката LuCI. Поэтому при чужих правках — отказ.
if [ -n "$(uci -q changes network)$(uci -q changes firewall)" ]; then
	die 1 "в network или firewall есть неприменённые изменения (uci changes). Примените их (uci commit) или отмените (uci revert network; uci revert firewall) и повторите импорт"
fi
SAVEDIR=$(mktemp -d /tmp/awgimport-uci.XXXXXX) || die 1 "не смог создать временный каталог"
U() {
	uci -q -t "$SAVEDIR" "$@" && return 0
	uci -q -t "$SAVEDIR" revert network
	uci -q -t "$SAVEDIR" revert firewall
	die 1 "не удалось записать настройки (uci $1 $2) — ничего не изменено"
}

uci -q -t "$SAVEDIR" delete network."$IFACE"
U set network."$IFACE"=interface
U set network."$IFACE".proto="$PROTO"
U set network."$IFACE".private_key="$privkey"
U set network."$IFACE".mtu="$mtu"
for a in $ADDRS; do U add_list network."$IFACE".addresses="$a"; done
while IFS="$TAB" read -r name val; do
	U set network."$IFACE"."${PFX}${name}"="$val"
done < "$OPTS"
# DNS внутри туннеля — только для awgsplit (dnsmasq спрашивает его через туннель).
# В опцию dns интерфейса НЕ пишем: иначе через туннель пошли бы вообще все DNS-запросы.
for d in $DNS4; do U add_list network."$IFACE".awgsplit_dns="$d"; done

for typ in "amneziawg_$IFACE" "amneziawg3_$IFACE" "wireguard_$IFACE"; do
	i=0
	while uci -q -t "$SAVEDIR" delete network.@"$typ"[0] 2>/dev/null; do
		i=$((i + 1)); [ "$i" -gt 50 ] && break
	done
done

P=$(uci -q -t "$SAVEDIR" add network "${PROTO}_${IFACE}") || die 1 "не удалось создать пира"
U set network."$P".description="awgsplit import"
U set network."$P".public_key="$pubkey"
[ -n "$psk" ] && U set network."$P".preshared_key="$psk"
U set network."$P".endpoint_host="$ep_host"
U set network."$P".endpoint_port="$ep_port"
[ -n "$keepalive" ] && U set network."$P".persistent_keepalive="$keepalive"
for a in $ALLOWED; do U add_list network."$P".allowed_ips="$a"; done
U set network."$P".route_allowed_ips='0'

# ---------------------------------------------------------------- firewall-зона
ZONE=$(uci -q show firewall | sed -n "s/^firewall\.\([^.]*\)\.name='awgsplit'\$/\1/p" | head -1)
if [ -z "$ZONE" ]; then
	ZONE=$(uci -q -t "$SAVEDIR" add firewall zone) || die 1 "не удалось создать зону firewall"
	U set firewall."$ZONE".name='awgsplit'
	U set firewall."$ZONE".input='REJECT'
	U set firewall."$ZONE".output='ACCEPT'
	U set firewall."$ZONE".forward='REJECT'
	U set firewall."$ZONE".masq='1'
	U set firewall."$ZONE".mtu_fix='1'
fi
uci -q -t "$SAVEDIR" del_list firewall."$ZONE".network="$IFACE"
U add_list firewall."$ZONE".network="$IFACE"

has_fwd=$(uci -q show firewall | awk -v q="'" '
	/^firewall\.[^.=]+=forwarding$/ { split($0, a, /[.=]/); fw[a[2]] = 1; next }
	{
		eq = index($0, "="); if (!eq) next
		k = substr($0, 1, eq - 1); v = substr($0, eq + 1); gsub(q, "", v)
		n = split(k, b, ".")
		if (n == 3 && (b[2] in fw)) { if (b[3] == "src") src[b[2]] = v; if (b[3] == "dest") dst[b[2]] = v }
	}
	END { for (s in fw) if (src[s] == "lan" && dst[s] == "awgsplit") f = 1; print f + 0 }')
if [ "$has_fwd" != 1 ]; then
	F=$(uci -q -t "$SAVEDIR" add firewall forwarding) || die 1 "не удалось создать forwarding"
	U set firewall."$F".src='lan'
	U set firewall."$F".dest='awgsplit'
fi

U commit network
U commit firewall

# ---------------------------------------------------------------- применение
/etc/init.d/firewall reload >/dev/null 2>&1

APPLIED=0
if ubus call network get_proto_handlers 2>/dev/null | jsonfilter -e "@['$PROTO']" >/dev/null 2>&1; then
	ubus call network reload >/dev/null 2>&1 && APPLIED=1
	# netifd не сравнивает секцию пира и addresses: при повторном импорте (новый IP сервера,
	# новые ключи пира) сам он интерфейс не перезапустит — перезапускаем явно
	if [ "$APPLIED" = 1 ] && [ -n "$stype" ]; then
		ubus call network.interface."$IFACE" down >/dev/null 2>&1
		ubus call network.interface."$IFACE" up >/dev/null 2>&1
	fi
fi

# DNS туннеля мог измениться — awgsplit пересоберёт конфиг dnsmasq (только если служба запущена)
if [ -f /var/run/awgsplit/started ]; then
	( sleep 8; /usr/bin/awgsplit apply ) >/dev/null 2>&1 </dev/null &
fi

echo "OK: интерфейс '$IFACE' создан (proto=$PROTO)"
echo "  адрес:          $(echo $ADDRS)"
echo "  сервер:         $ep_host:$ep_port"
echo "  MTU:            $mtu"
[ -n "$keepalive" ] && echo "  keepalive:      $keepalive"
echo "  AmneziaWG-поля: $(cut -f1 "$OPTS" | tr '\n' ' ')"
echo "  DNS туннеля:    ${DNS4:-нет — домены будут резолвиться через провайдера}"
[ -n "$ignored" ] && echo "  пропущены поля:$ignored"
[ -n "$WARN" ] && echo "$WARN"
echo
if [ "$APPLIED" = 1 ]; then
	if [ -n "$stype" ]; then echo "Интерфейс перезапущен с новыми настройками и поднимается."
	else echo "Интерфейс применён и поднимается."; fi
else
	echo "ВНИМАНИЕ: сетевая служба ещё не знает протокол $PROTO (пакет поставлен без перезагрузки)."
	echo "Перезагрузи роутер — интерфейс поднимется сам."
fi
if ! uci -q show awgsplit | grep -q "\.interface='$IFACE'\$"; then
	echo "Дальше: на вкладке «Туннели и списки» выбери '$IFACE' в нужном туннеле и нажми «Сохранить и применить»."
fi
cleanup
exit 0
