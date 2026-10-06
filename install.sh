#!/bin/sh
# Установщик awgsplit. Запускать НА РОУТЕРЕ из распакованной папки.
#   ./install.sh            — полная установка
#   ./install.sh --no-deps  — только файлы, без установки пакетов

cd "$(dirname "$0")" || exit 1

GREEN=''; RED=''; YELL=''; NC=''
if [ -t 1 ]; then
	GREEN='\033[0;32m'; RED='\033[0;31m'; YELL='\033[0;33m'; NC='\033[0m'
fi
ok()   { printf "${GREEN}[OK]${NC}   %s\n" "$*"; }
warn() { printf "${YELL}[!!]${NC}   %s\n" "$*"; }
err()  { printf "${RED}[ERR]${NC}  %s\n" "$*"; }
step() { printf "\n=== %s ===\n" "$*"; }
die()  { err "$*"; exit 1; }

NODEPS=0
[ "$1" = "--no-deps" ] && NODEPS=1

[ -f /etc/openwrt_release ] || die "Это не OpenWrt"
. /etc/openwrt_release
ok "OpenWrt $DISTRIB_RELEASE / $DISTRIB_TARGET"
command -v apk >/dev/null 2>&1 || die "Нужен OpenWrt 25.12+ с менеджером пакетов apk"
[ -f files/usr/bin/awgsplit ] || die "Запускайте install.sh из распакованной папки awgsplit"

BK=/root/awgsplit-backup
mkdir -p "$BK"

has_nftset() {
	case " $(dnsmasq --version 2>/dev/null | sed -n 's/^Compile time options: //p') " in
		*" nftset "*) return 0 ;;
	esac
	return 1
}

pkg_installed() { apk list -I "$1" 2>/dev/null | grep -q "^$1-[0-9]"; }

# ---------------------------------------------------------------- Podkop
PODKOP=0
if [ -x /etc/init.d/podkop ] && /etc/init.d/podkop enabled 2>/dev/null; then PODKOP=1; fi
nft list table inet PodkopTable >/dev/null 2>&1 && PODKOP=1

# ---------------------------------------------------------------- зависимости
CF=/etc/apk/repositories.d/customfeeds.list
FEED="https://2grey.github.io/awg-openwrt/${DISTRIB_RELEASE}/${DISTRIB_TARGET}/packages.adb"

if [ "$NODEPS" = 0 ]; then
	# после sysupgrade в фиде 2Grey остаётся старая версия OpenWrt — apk update на ней падает
	if [ -f "$CF" ] && grep -q '2grey\.github\.io/awg-openwrt' "$CF" && ! grep -qxF "$FEED" "$CF"; then
		sed -i '\#2grey\.github\.io/awg-openwrt#d' "$CF"
		echo "$FEED" >> "$CF"
		ok "Фид AmneziaWG переключён на $DISTRIB_RELEASE"
	fi

	step "dnsmasq-full"
	if has_nftset; then
		ok "dnsmasq уже умеет nftset"
	else
		warn "Меняю dnsmasq на dnsmasq-full (настройки DHCP/DNS сохраняются)"
		cp /etc/config/dhcp "$BK/dhcp" || die "Не смог сохранить /etc/config/dhcp"
		RB=/tmp/awgsplit-rollback
		rm -rf "$RB"; mkdir -p "$RB/cache"
		apk update >/dev/null 2>&1 || warn "apk update прошёл с ошибками — пробую дальше"
		# копия старого dnsmasq для отката — пока DNS ещё работает
		apk fetch -o "$RB" dnsmasq >/dev/null 2>&1 || warn "Не смог сохранить копию dnsmasq для отката"
		# apk сам снимет dnsmasq (тот же provides). С явным кэшем всё скачивается ДО удаления старого.
		apk add --cache-dir "$RB/cache" --cache-predownload dnsmasq-full > "$RB/log" 2>&1
		tail -5 "$RB/log"
		if pkg_installed dnsmasq-full && has_nftset; then
			cp "$BK/dhcp" /etc/config/dhcp
			/etc/init.d/dnsmasq restart >/dev/null 2>&1
			ok "dnsmasq-full установлен"
		else
			err "dnsmasq-full не встал — откатываю"
			pkg_installed dnsmasq-full && apk del dnsmasq-full >/dev/null 2>&1
			if ! pkg_installed dnsmasq; then
				ls "$RB"/dnsmasq-*.apk >/dev/null 2>&1 && apk add --allow-untrusted "$RB"/dnsmasq-*.apk >/dev/null 2>&1
			fi
			cp "$BK/dhcp" /etc/config/dhcp
			/etc/init.d/dnsmasq enable >/dev/null 2>&1
			/etc/init.d/dnsmasq restart >/dev/null 2>&1
			pkg_installed dnsmasq || pkg_installed dnsmasq-full \
				|| err "dnsmasq не установлен! Верните его: apk add dnsmasq"
			die "Установка остановлена. Лог apk: $RB/log"
		fi
	fi

	step "nftables"
	# в OpenWrt 25.12 nftables стоит всегда (на нём fw4)
	if command -v nft >/dev/null 2>&1; then ok "nftables есть"
	elif apk add nftables >/dev/null 2>&1; then ok "nftables поставлен"
	else die "Нет nftables и не смог его поставить"; fi

	# conntrack: при переключении туннеля сбрасываем соединения сразу (без него ядро сделает это на следующем пакете)
	if command -v conntrack >/dev/null 2>&1; then ok "conntrack есть"
	elif apk add conntrack >/dev/null 2>&1; then ok "conntrack поставлен"
	else warn "Не смог поставить conntrack — не страшно, при переключении туннеля соединения переподключатся чуть дольше"; fi

	step "AmneziaWG"
	if [ -f /lib/netifd/proto/amneziawg.sh ] && [ -x /usr/bin/awg ]; then
		ok "AmneziaWG уже установлен ($(apk list -I amneziawg-tools 2>/dev/null | cut -d' ' -f1))"
	elif [ -f /lib/netifd/proto/amneziawg3.sh ]; then
		ok "Найден amneziawg3 — буду использовать его"
	else
		warn "Ставлю AmneziaWG из фида 2Grey/awg-openwrt"
		mkdir -p /etc/apk/keys /etc/apk/repositories.d
		if wget -q -O /etc/apk/keys/awg-openwrt-feed.pem https://2grey.github.io/awg-openwrt/keys/awg-openwrt-feed.pem; then
			grep -qxF "$FEED" "$CF" 2>/dev/null || echo "$FEED" >> "$CF"
			apk update >/dev/null 2>&1
			apk add kmod-amneziawg amneziawg-tools luci-proto-amneziawg > /tmp/awgsplit-awg.log 2>&1
			tail -5 /tmp/awgsplit-awg.log
			if pkg_installed kmod-amneziawg && pkg_installed amneziawg-tools; then
				apk add luci-i18n-amneziawg-ru >/dev/null 2>&1
				ok "AmneziaWG установлен"
				warn "После установки нужна перезагрузка роутера, чтобы сеть узнала новый протокол"
				NEED_REBOOT=1
			else
				warn "Не получилось поставить AmneziaWG (нет пакетов под $DISTRIB_RELEASE/$DISTRIB_TARGET?)"
				warn "Инструкция: https://github.com/2Grey/awg-openwrt"
			fi
		else
			warn "Не скачался ключ фида 2Grey — проверьте интернет. Инструкция: https://github.com/2Grey/awg-openwrt"
		fi
	fi
fi

# ---------------------------------------------------------------- файлы
step "Копирую файлы"

put() { # mode src dst — атомарно, без утилиты install (её нет в BusyBox)
	mkdir -p "${3%/*}" && cp "$2" "$3.awgnew" && sed -i 's/\r$//' "$3.awgnew" \
		&& chmod "$1" "$3.awgnew" && mv -f "$3.awgnew" "$3" || die "Не смог записать $3"
}

put 0755 files/usr/bin/awgsplit                  /usr/bin/awgsplit
put 0755 files/etc/init.d/awgsplit               /etc/init.d/awgsplit
put 0755 files/usr/share/awgsplit/import-awg.sh  /usr/share/awgsplit/import-awg.sh
put 0755 files/usr/libexec/rpcd/luci.awgsplit    /usr/libexec/rpcd/luci.awgsplit
put 0644 files/usr/share/rpcd/acl.d/luci-app-awgsplit.json /usr/share/rpcd/acl.d/luci-app-awgsplit.json
put 0644 files/usr/share/luci/menu.d/luci-app-awgsplit.json /usr/share/luci/menu.d/luci-app-awgsplit.json
for f in overview tunnels import diag; do
	put 0644 "files/www/luci-static/resources/view/awgsplit/$f.js" "/www/luci-static/resources/view/awgsplit/$f.js"
done
[ -f README.md ] && put 0644 README.md /usr/share/awgsplit/README
mkdir -p /usr/share/awgsplit/lists
ok "Файлы скопированы"

if [ -f /etc/config/awgsplit ]; then
	cp /etc/config/awgsplit "$BK/awgsplit.$(date +%Y%m%d-%H%M%S)"
	ok "Ваш /etc/config/awgsplit оставлен как есть (копия в $BK)"
else
	put 0644 files/etc/config/awgsplit /etc/config/awgsplit
	ok "Установлен стартовый /etc/config/awgsplit (ваши домены уже внутри)"
fi

# настройки переживут sysupgrade (сами файлы после прошивки надо будет поставить заново)
grep -qx '/etc/config/awgsplit' /etc/sysupgrade.conf 2>/dev/null || echo '/etc/config/awgsplit' >> /etc/sysupgrade.conf

/etc/init.d/rpcd restart >/dev/null 2>&1 && ok "rpcd перезапущен"
rm -rf /tmp/luci-indexcache* /tmp/luci-modulecache 2>/dev/null
ok "Кэш LuCI сброшен"

# ---------------------------------------------------------------- списки
step "Качаю списки доменов"
if /usr/bin/awgsplit update; then
	ok "Списки скачаны"
else
	warn "Часть списков не скачалась: $(cat /usr/share/awgsplit/lists/.failed 2>/dev/null)"
	warn "Служба докачает их сама, когда появится интернет"
fi

# ---------------------------------------------------------------- запуск
step "Запуск"
if [ "$PODKOP" = 1 ]; then
	warn "Работает Podkop — он тоже перехватывает DNS и трафик, вместе они будут мешать друг другу."
	warn "awgsplit установлен, но НЕ запущен. Когда будете готовы перейти:"
	warn "  /etc/init.d/podkop stop && /etc/init.d/podkop disable"
	warn "  apk del luci-app-podkop podkop"
	warn "  (sing-box удаляйте, только если он больше ни для чего не нужен)"
	warn "  затем: /etc/init.d/awgsplit enable && /etc/init.d/awgsplit start"
else
	# остатки Podkop в dhcp: dnsmasq слал бы все запросы в несуществующий 127.0.0.42
	D='dhcp.@dnsmasq[0]'
	if uci -q get "$D.server" | grep -q '127\.0\.0\.42'; then
		cp /etc/config/dhcp "$BK/dhcp.podkop"
		uci -q del_list "$D.server=127.0.0.42#53"
		uci -q del_list "$D.server=127.0.0.42"
		for v in $(uci -q get "$D.podkop_server"); do uci -q add_list "$D.server=$v"; done
		v=$(uci -q get "$D.podkop_noresolv"); uci -q set "$D.noresolv=${v:-0}"
		v=$(uci -q get "$D.podkop_cachesize"); [ -n "$v" ] && uci -q set "$D.cachesize=$v"
		uci -q delete "$D.podkop_server"; uci -q delete "$D.podkop_noresolv"; uci -q delete "$D.podkop_cachesize"
		uci commit dhcp
		/etc/init.d/dnsmasq restart >/dev/null 2>&1
		warn "Убрал из dnsmasq остатки Podkop (сервер 127.0.0.42), копия dhcp в $BK"
	fi
	/etc/init.d/awgsplit enable && ok "Автозапуск включён"
	# stop при первой установке ругается «service not found» — это нормально, прячем
	/etc/init.d/awgsplit stop >/dev/null 2>&1
	/etc/init.d/awgsplit start && ok "awgsplit запущен"
fi

step "Готово"
cat <<EOF

Дальше:
  1. LuCI: Сервисы → AWG Split → «Импорт конфига»: загрузите .conf от AmneziaVPN,
     имя интерфейса awg_main (для второго сервера — awg_second)
  2. «Туннели и списки»: проверьте туннель, списки, свои домены → «Сохранить и применить»
  3. «Обзор»: связь туннеля должна стать «Работает»

Проверка из SSH:  awgsplit status   /   awgsplit dump main
EOF
[ "$NEED_REBOOT" = 1 ] && warn "Не забудьте перезагрузить роутер после установки AmneziaWG: reboot"
exit 0
