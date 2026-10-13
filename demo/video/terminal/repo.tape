# Terminal recording for the "repo" scene: clone one agent's Artifacts repo
# with plain git and read its history.
#   REPO_NAME=agent-<name> REPO_REMOTE=https://…/agent-<name>.git node scripts/record.mjs repo
# A short-lived read token is created off camera; only $TOKEN is shown.

Output frames-repo/
Require git
Source terminal/theme.tape

Hide
Type `export PS1='$ ' TOKEN=$(node scripts/artifacts-token.mjs $REPO_NAME 900) && cd $(mktemp -d) && clear`
Enter
Sleep 6s
Show

Type `git clone -c http.extraHeader="Authorization: Bearer $TOKEN" $REPO_REMOTE matthew`
Sleep 400ms
Enter
Sleep 4s

Type `cd matthew && git log --format='%C(yellow)%h%Creset %s%n%(trailers:key=Codemode-Status,key=Codemode-Examples)'`
Sleep 400ms
Enter
Sleep 7s

Type "clear && cat run.js"
Sleep 300ms
Enter
Sleep 7s

Type "clear && cat result.json | head -c 400; echo"
Sleep 300ms
Enter
Sleep 5s
