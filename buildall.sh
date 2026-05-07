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

primoPrebuild() {
  # Generates platform/mv3/extension/js/primo-defaults.js from
  # primo-defaults.json. Both the JSON and the generated JS are gitignored.
  printf "${bold}${CYA}\n Primo prebuild (primo-defaults.json -> primo-defaults.js)... \n${c0}"
  try node ${HERE}/tools/primo-prebuild.mjs
}

prepareBuild() {
  primoPrebuild
  printf "${bold}${YEL}\n Cleaning Build... \n${c0}"
  ${HERE}/tools/make-clean.sh
  printf "${bold}${GRE}\n Downloading Lists... \n${c0}"
  ${HERE}/tools/pull-assets.sh
}

buildChromiumMV2() {
  printf "${bold}${GRE}\n Building MV2... \n${c0}" &&
  ${HERE}/tools/make-chromium.sh
}
case $1 in
	--mv2) prepareBuild; buildChromiumMV2; exit 0;;
esac

buildChromiumMV3() {
  printf "${bold}${GRE}\n Building MV3... \n${c0}" &&
  ${HERE}/tools/make-mv3.sh
}

prepareBuild; buildChromiumMV2; buildChromiumMV3;

exit 0
