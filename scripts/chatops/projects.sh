#!/usr/bin/env bash
# Source this file into an authenticated PM shell. It does not start AI workers.
# Requirements: gh, jq; PM token with Projects write and appropriate repo access.
export OWNER=anpavel84-afk
export REPO=$OWNER/gobadminton-clean
: "${PROJECT_NUMBER:?Set the existing GitHub Projects v2 number}"
export PROJECT_ID=$(gh project view "$PROJECT_NUMBER" --owner "$OWNER" --format json --jq .id)

# Field IDs/option IDs are looked up, never guessed or hard-coded.
set_select() {
  local issue_url=$1 field_name=$2 option_name=$3 fields field_id option_id item_id
  fields=$(gh project field-list "$PROJECT_NUMBER" --owner "$OWNER" --format json --limit 100)
  field_id=$(jq -er --arg n "$field_name" '.fields[] | select(.name==$n) | .id' <<<"$fields")
  option_id=$(jq -er --arg n "$field_name" --arg o "$option_name" \
    '.fields[] | select(.name==$n) | .options[] | select(.name==$o) | .id' <<<"$fields")
  item_id=$(gh project item-add "$PROJECT_NUMBER" --owner "$OWNER" --url "$issue_url" --format json --jq .id)
  gh project item-edit --id "$item_id" --project-id "$PROJECT_ID" \
    --field-id "$field_id" --single-select-option-id "$option_id"
}
set_text() {
  local issue_url=$1 field_name=$2 text=$3 field_id item_id
  field_id=$(gh project field-list "$PROJECT_NUMBER" --owner "$OWNER" --format json --limit 100 \
    | jq -er --arg n "$field_name" ' .fields[] | select(.name==$n) | .id')
  [[ -n $field_id ]] || return 1
  item_id=$(gh project item-add "$PROJECT_NUMBER" --owner "$OWNER" --url "$issue_url" --format json --jq .id)
  gh project item-edit --id "$item_id" --project-id "$PROJECT_ID" --field-id "$field_id" --text "$text"
}
board() {
  # --limit must cover the project; this renders a small board in the chat's terminal.
  gh project item-list "$PROJECT_NUMBER" --owner "$OWNER" --format json --limit 1000 |
    jq -r '.items[] | [(.content.number//""|tostring),.title,(.stage//.Stage//"Backlog"),(.role//.Role//""),(.content.url//"")] | @tsv'
}
