#!/bin/sh
# Сборка .apk внутри контейнера Alpine (apk-tools 3 — тот же формат, что в OpenWrt 25.12).
# Не запускайте вручную: см. packaging/build.sh
#   /src  — репозиторий (только чтение)     /out — куда положить пакет
#   /key  — каталог с закрытым ключом awgsplit.rsa (если есть — пакет подписывается)
set -e
VERSION="${AWGSPLIT_VERSION:-1.2.0}"
apk add -q apk-tools >/dev/null

S=/tmp/stage
rm -rf "$S"; mkdir -p "$S"
cp -r /src/files/. "$S/"
mkdir -p "$S/usr/share/awgsplit"
cp /src/README.md "$S/usr/share/awgsplit/README"
# конфиг в пакет не кладём: apk при обновлении оставлял бы рядом мусор awgsplit.apk-new.
# Шаблон лежит в /usr/share, а post-install создаёт /etc/config/awgsplit, только если его нет.
mv "$S/etc/config/awgsplit" "$S/usr/share/awgsplit/config.default"
rmdir "$S/etc/config" 2>/dev/null || true

# роутеру нужны LF без BOM, а Windows-редакторы любят CRLF
find "$S" -type f | while read -r f; do
	sed -i 's/\r$//; 1s/^\xEF\xBB\xBF//' "$f"
done
find "$S" -type d -exec chmod 755 {} +
find "$S" -type f -exec chmod 644 {} +
chmod 755 "$S/usr/bin/awgsplit" "$S/etc/init.d/awgsplit" "$S/usr/share/awgsplit/import-awg.sh" \
	"$S/usr/libexec/rpcd/luci.awgsplit" "$S/www/cgi-bin/awgsplit-state"

mkdir -p /out
SIGN=""
[ -f /key/awgsplit.rsa ] && SIGN="--sign-key /key/awgsplit.rsa"
[ -n "$SIGN" ] || echo "!! ключа подписи нет — пакет получится неподписанным, LuCI его не примет"

# shellcheck disable=SC2086
apk mkpkg \
	--info "name:awgsplit" \
	--info "version:${VERSION}-r0" \
	--info "arch:noarch" \
	--info "description:Раздельная и полная маршрутизация через AmneziaWG для OpenWrt (LuCI: Сервисы - AWG Split)" \
	--info "license:MIT" \
	--info "url:https://github.com/XYZ-WEB3/awgsplit" \
	--script "post-install:/src/packaging/scripts/post-install" \
	--script "post-upgrade:/src/packaging/scripts/post-install" \
	--script "pre-deinstall:/src/packaging/scripts/pre-deinstall" \
	--script "post-deinstall:/src/packaging/scripts/post-deinstall" \
	--files "$S" $SIGN --output "/out/awgsplit-${VERSION}-r0.apk"

# одиночный файл для «Загрузить пакет» в LuCI и репозиторий (фид) для обновлений из LuCI:
# в фиде файл называется <имя>-<версия>.apk, рядом лежит подписанный индекс packages.adb
cp "/out/awgsplit-${VERSION}-r0.apk" /out/awgsplit.apk
rm -rf /out/feed; mkdir -p /out/feed
cp "/out/awgsplit-${VERSION}-r0.apk" /out/feed/
# индекс строится по подписанному пакету: apk должен доверять нашему ключу
mkdir -p /etc/apk/keys; cp /key/awgsplit.rsa.pub /etc/apk/keys/awgsplit.rsa.pub
# shellcheck disable=SC2086
apk mkndx $SIGN --output /out/feed/packages.adb "/out/feed/awgsplit-${VERSION}-r0.apk"
rm -f "/out/awgsplit-${VERSION}-r0.apk"
ls -l /out/awgsplit.apk /out/feed
