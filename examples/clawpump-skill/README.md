# ZOOAI Creator Check, a ClawPump community skill

`zooai-creator-check/` is laid out the way the ClawPump skills registry expects
(`skills/<slug>/SKILL.md` + `metadata.json`, see https://github.com/Clawpump/agents-skills).

To submit it: fork Clawpump/agents-skills, copy `zooai-creator-check/` into `skills/`,
add `registry-entry.json` to the `skills` array of `registry.json`, open a pull request.

The same skill is served at https://zooaiagency.com/skill.md, and the check itself at
`GET https://zooaiagency.com/api/check/<mint>` (proxied to the north node's `/v1/check/:mint`).
