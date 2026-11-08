# Applies one change from the status pane ($op) to feature_list.json (the input).
# Emits {list, log, blocked?} when applied, {keep: true} to retry once $running no longer holds the item,
# or {error} to drop the change with a reason.

def text($max): type == "string" and (gsub("^\\s+|\\s+$"; "") | length > 0 and length <= $max) and (test("[\u0000-\u001f\u007f]") | not);
def trimmed: gsub("^\\s+|\\s+$"; "");
def spec: { description: (.plain + (if (.done_when // "") != "" then " Done when: " + .done_when else "" end)), verify: (if (.done_when // "") != "" then .done_when else .plain end) };
def pending($running): .passes == false and (.id as $id | $running | index($id) | not);
def first_pending($running): ([.features | to_entries[] | select(.value | pending($running)) | .key][0]) // (.features | length);
def insert_at($i; $item): .features = .features[:$i] + [$item] + .features[$i:];
def item($id): .features[] | select(.id == $id);
def next_id: "U" + ((([.features[].id | select(test("^U[0-9]+$")) | ltrimstr("U") | tonumber] | max) // 0) + 1 | tostring);
def add($new; $first):
  ($new.id) as $id
  | (if $first then first_pending($running) else ([.features | to_entries[] | select(.value.id == "FINAL") | .key][0] // (.features | length)) end) as $at
  | insert_at($at; $new)
  | (.features[] | select(.id == "FINAL") | .depends_on) |= ((. // []) + [$id] | unique);

($op[0]) as $o
| ($o.id // "") as $id
| if ($o | type) != "object" then {error: "not a JSON object"}
  elif $o.op == "add" then
    if ($o.plain | text(500) | not) then {error: "a new task needs a plain sentence of up to 500 characters"}
    elif ($o.done_when // "" | . == "" or text(500) | not) then {error: "done_when must be up to 500 characters"}
    elif ($o.area // "" | . == "" or text(40) | not) then {error: "area must be up to 40 characters"}
    elif (($o.kind // "build") | IN("build", "eval", "design") | not) then {error: "kind must be build, eval or design"}
    elif (($o.metrics // []) | type != "array" or length > 10 or any(.[]; (.name | text(40) | not) or ((.target // 0) | type != "number"))) then {error: "metrics must be up to 10 {name, target?} entries"}
    else
      next_id as $new_id
      | ({plain: ($o.plain | trimmed), done_when: ($o.done_when // "" | trimmed)} | spec) as $spec
      | ({id: $new_id, category: "functional", ui: (($o.kind // "build") == "design"), area: ($o.area // "Added by you" | trimmed),
          plain: ($o.plain | trimmed), done_when: ($o.done_when // "" | trimmed), kind: ($o.kind // "build")}
         + (if ($o.metrics // []) == [] then {} else {metrics: $o.metrics} end)
         + $spec + {depends_on: ($o.depends_on // [] | map(select(type == "string"))), touches: ["**"], passes: false, evidence: null}) as $new
      | {list: add($new; $o.first == true), log: "added \($new_id): \($new.plain)"}
    end
  elif ($id | type) != "string" or ([item($id)] | length) == 0 then {error: "no task \($id)"}
  elif $o.op == "review" then
    if ($o.verdict | IN("approved", "changes") | not) then {error: "verdict must be approved or changes"}
    elif $o.verdict == "approved" then {list: ((.features[] | select(.id == $id) | .review) = "approved"), log: "you approved the screenshots of \($id)"}
    elif ($o.note | text(500) | not) then {error: "say what should change, in up to 500 characters"}
    else
      (item($id)) as $base
      | next_id as $new_id
      | ({plain: ("Fix after review of \($id): " + ($o.note | trimmed)), done_when: ""} | spec) as $spec
      | ({id: $new_id, category: "functional", ui: true, area: ($base.area // "Added by you"), plain: ("Fix after review: " + ($o.note | trimmed)), done_when: "", kind: "design"}
         + $spec + {depends_on: [$id], touches: ($base.touches // ["**"]), passes: false, evidence: null}) as $new
      | {list: ((.features[] | select(.id == $id) | .review) = "changes" | add($new; true)), log: "added \($new_id) to fix \($id) after your review"}
    end
  elif (item($id).passes) then {error: "\($id) already passes"}
  elif ($running | index($id)) then {keep: true}
  elif $o.op == "edit" then
    if ($o.plain | text(500) | not) then {error: "an edit needs a plain sentence of up to 500 characters"}
    elif ($o.done_when // "" | . == "" or text(500) | not) then {error: "done_when must be up to 500 characters"}
    else ({plain: ($o.plain | trimmed), done_when: ($o.done_when // "" | trimmed)}) as $fields
      | {list: ((.features[] | select(.id == $id)) |= (. + $fields + ($fields | spec) + {edited: true})), log: "reworded \($id): \($fields.plain)"}
    end
  elif $o.op == "first" then
    (item($id)) as $moving
    | (.features |= map(select(.id != $id))) as $rest
    | {list: ($rest | insert_at($rest | first_pending($running); $moving)), log: "\($id) runs next"}
  elif $o.op == "skip" then {list: ., blocked: $id, log: "skipped \($id)"}
  else {error: "unknown change \($o.op)"}
  end
