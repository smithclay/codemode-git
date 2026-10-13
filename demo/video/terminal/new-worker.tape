# Terminal recording for the "new-worker" scene: a fresh Worker with Code Mode
# and codemode-git, from `cf init` to a dry-run deploy (nothing is deployed).
#   npm run record   (from demo/video; writes public/clips/new-worker.mp4)
# VHS writes raw frames; scripts/record.mjs encodes them, because VHS's own
# encoder fails silently with ffmpeg 9.
# The two edited files come from terminal/new-worker/, copied in off-camera
# and then shown with cat.

Output frames-new-worker/
Require npx
Source terminal/theme.tape

# Off camera: a clean prompt, an empty directory, no credentials (the deploy is
# a dry run), and npm's minimum-release-age check off for this session only.
Hide
Type "export DEMO=$PWD/terminal/new-worker PS1='$ ' NPM_CONFIG_MIN_RELEASE_AGE=0 NPM_CONFIG_UPDATE_NOTIFIER=false && unset CLOUDFLARE_API_TOKEN && cd $(mktemp -d) && clear"
Enter
Sleep 500ms
Show

Type "npx cf init lava-agent --package-manager npm"
Sleep 400ms
Enter
Wait+Screen /cf deploy/
Sleep 2s

Type "cd lava-agent && npm install @cloudflare/codemode @smithclay/codemode-git"
Sleep 400ms
Enter
Wait+Line /^\$\s*$/
Sleep 1.5s

# Off camera: add the agent and its bindings.
Hide
Type "cp $DEMO/cloudflare.config.ts . && cp $DEMO/src/index.ts src/ && clear"
Enter
Sleep 500ms
Show

Type "cat cloudflare.config.ts"
Sleep 300ms
Enter
Sleep 6s

Type "clear && head -24 src/index.ts"
Sleep 300ms
Enter
Sleep 8s

Type "clear && npx cf deploy --dry-run"
Sleep 300ms
Enter
Wait+Screen /exiting now/
Sleep 5s
