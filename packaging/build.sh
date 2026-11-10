#!/bin/sh
# Сборка пакета dist/awgsplit.apk. Нужны Docker и закрытый ключ подписи.
#   sh packaging/build.sh [версия]        например: sh packaging/build.sh 1.2.0
# Закрытый ключ лежит ВНЕ репозитория: ~/.awgsplit-signing/awgsplit.rsa (каталог можно сменить
# переменной AWGSPLIT_KEYDIR). Открытая часть — files/etc/apk/keys/awgsplit.rsa.pub.
# Новый ключ:
#   docker run --rm -v ~/.awgsplit-signing:/key alpine:edge sh -c \
#     'apk add -q openssl && openssl genrsa -out /key/awgsplit.rsa 4096 && openssl rsa -in /key/awgsplit.rsa -pubout -out /key/awgsplit.rsa.pub'
cd "$(dirname "$0")/.." || exit 1
VER="${1:-1.2.0}"
KEYDIR="${AWGSPLIT_KEYDIR:-$HOME/.awgsplit-signing}"
[ -f "$KEYDIR/awgsplit.rsa" ] || { echo "Нет ключа $KEYDIR/awgsplit.rsa"; exit 1; }
HERE=$(pwd -W 2>/dev/null || pwd)
KEYW=$(cd "$KEYDIR" && { pwd -W 2>/dev/null || pwd; })
mkdir -p dist
MSYS_NO_PATHCONV=1 docker run --rm -e AWGSPLIT_VERSION="$VER" \
	-v "$HERE:/src:ro" -v "$KEYW:/key:ro" -v "$HERE/dist:/out" \
	alpine:edge sh /src/packaging/mkpkg-inside.sh
# фид кладём в репозиторий: роутер берёт его с raw.githubusercontent.com (см. README)
rm -rf feed && cp -r dist/feed feed && echo "feed/ обновлён:" && ls feed
