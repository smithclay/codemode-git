# Terminal recording for the "provenance" scene: follow DABstep task 2557's
# Codemode-Examples trailer from its Artifacts repo to the run it learned from
# (task 2556, commit dd79a79), with plain git.
#   ARTIFACTS_BASE=https://<account>.artifacts.cloudflare.net/git/codemode-git node scripts/record.mjs provenance
# Short-lived read tokens are created off camera; only $T1 and $T2 are shown.

Output frames-provenance/
Require git
Source terminal/theme.tape

Hide
Type `export PS1='$ ' T1=$(node scripts/artifacts-token.mjs full1-codemode-git-examples-t2557 900) T2=$(node scripts/artifacts-token.mjs full1-codemode-git-examples-t2556 900) R=$ARTIFACTS_BASE && cd $(mktemp -d) && clear`
Enter
Sleep 10s
Show

Type `git clone -q -c http.extraHeader="Authorization: Bearer $T1" $R/full1-codemode-git-examples-t2557.git task-2557`
Sleep 400ms
Enter
Sleep 3s

Type `git -C task-2557 log -1 --skip 1 --format='%C(yellow)%h%Creset %s%n%n%(trailers:key=Codemode-Status,key=Codemode-Examples)'`
Sleep 400ms
Enter
Sleep 7s

Type `git clone -q -c http.extraHeader="Authorization: Bearer $T2" $R/full1-codemode-git-examples-t2556.git task-2556`
Sleep 400ms
Enter
Sleep 3s

Type "clear && git -C task-2556 show dd79a79:run.js | head -22"
Sleep 400ms
Enter
Sleep 9s
