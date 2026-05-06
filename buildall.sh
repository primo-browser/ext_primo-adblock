#!/bin/bash

export HERE=${PWD} &&

YEL='\033[1;33m' # Yellow
CYA='\033[1;96m' # Cyan
RED='\033[1;31m' # Red
GRE='\033[1;32m' # Green
c0='\033[0m' # Reset Text
bold='\033[1m' # Bold Text
underline='\033[4m' # Underline Text

# Error handling
yell() { echo "$0: $*" >&2; }
die() { yell "$*"; exit 111; }
try() { "$@" || die "${RED}Failed $*"; }

cleanBuild() {
  printf "${bold}${YEL}\n Cleaning Build... \n${c0}"
  ${HERE}/tools/make-clean.sh
}
case $1 in
	--clean) cleanBuild; exit 0;;
esac

${HERE}/tools/pull-assets.sh &&

printf "${bold}${GRE}\n Building MV3... \n${c0}"
${HERE}/tools/make-mv3.sh &&

buildChromiumMV2() {
  printf "${bold}${GRE}\n Building MV2... \n${c0}"
  ${HERE}/tools/make-chromium.sh
}
case $1 in
	--mv2) buildChromiumMV2;
esac

exit 0
