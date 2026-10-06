#!/bin/sh
# Установка awgsplit одной командой на роутере с OpenWrt 25.12+:
#
#   wget -O /tmp/awgsplit-online.sh https://raw.githubusercontent.com/XYZ-WEB3/awgsplit/main/install-online.sh && sh /tmp/awgsplit-online.sh
#
# Скачивает архив репозитория с GitHub и запускает install.sh.
# Аргументы передаются установщику, например: sh /tmp/awgsplit-online.sh --no-deps

REPO="${AWGSPLIT_REPO:-XYZ-WEB3/awgsplit}"
REF="${AWGSPLIT_REF:-main}"
TMP=/tmp/awgsplit-src

rm -rf "$TMP" && mkdir -p "$TMP" || { echo "Не смог создать $TMP"; exit 1; }

echo "Скачиваю awgsplit ($REPO, ветка $REF)..."
if ! wget -q -T 30 -O "$TMP/src.tar.gz" "https://codeload.github.com/$REPO/tar.gz/refs/heads/$REF"; then
	echo "Не скачалось. Проверьте интернет и дату на роутере (date): при неверном времени HTTPS не работает."
	exit 1
fi

if ! tar -xzf "$TMP/src.tar.gz" -C "$TMP" 2>/dev/null; then
	gzip -dc "$TMP/src.tar.gz" | tar -xf - -C "$TMP" || { echo "Не смог распаковать архив"; exit 1; }
fi

dir=$(find "$TMP" -maxdepth 2 -type f -name install.sh | head -1)
dir=${dir%/install.sh}
[ -n "$dir" ] && [ -f "$dir/files/usr/bin/awgsplit" ] || { echo "В архиве нет установщика"; exit 1; }

cd "$dir" && sh ./install.sh "$@"
