# Terminal recording for the "scale" scene: the real 1,000-agent swarm
# against the deployed example (one Durable Object, Artifacts repo and commit
# per agent).
#   WORKER_URL=https://… SECRETS=/path/to/secrets.json node scripts/record.mjs scale
# ADMIN_TOKEN is read off camera from SECRETS.

Output frames-scale/
Require node
Source terminal/theme.tape

Hide
Type `export PS1='$ ' ADMIN_TOKEN=$(node -p "require('$SECRETS').ADMIN_TOKEN") && cd ../../examples/agent && clear`
Enter
Sleep 1s
Show

Type "node scripts/swarm.mjs $WORKER_URL --agents 1000 --concurrency 200"
Sleep 500ms
Enter
Wait+Screen /sampleRepo/
Sleep 6s
