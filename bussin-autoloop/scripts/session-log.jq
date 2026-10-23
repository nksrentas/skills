def clip: tostring | gsub("[\u0000-\u001f\u007f-\u009f\u200e\u200f\u202a-\u202e\u2066-\u2069]"; " ") | gsub("\\s+"; " ") | ltrimstr(" ") | .[0:200];
def line($step; $kind; $text): [(now | strflocaltime("%H:%M:%S")), $step, $kind, ($text | clip)] | join("\t");
def bash_step: if test("\\.loop/verify\\.sh") then "gate" elif test("git commit") then "commit" else "-" end;
def args: if type == "string" then (fromjson? // {}) elif type == "object" then . else {} end;

def tool($name; $input):
  if ($name | test("^(Bash|bash|shell)$")) then ($input.command // "" | tostring) as $c | line($c | bash_step; "Bash"; $c)
  elif ($name | test("^(Edit|Write|MultiEdit|NotebookEdit|edit|create|write|str_replace_editor|apply_patch)$")) then line("implement"; "Edit"; $input.file_path // $input.path // $input.notebook_path // "")
  elif ($name | test("^(Read|Glob|Grep|LS|view|read|glob|grep)$")) then line("-"; "Read"; $input.file_path // $input.path // $input.pattern // "")
  elif ($name | test("^(Agent|Task|task)$")) then
    ("\($input.description // "") \($input.prompt // "")") as $about
    | line(if ($about | test("review"; "i")) then "review" else "-" end; "Agent"; $input.description // "subagent")
  elif ($name | test("^(Skill|skill)$")) then line("-"; "Skill"; $input.skill // $input.name // "")
  elif ($name | test("playwright|browser|chrome"; "i")) then line("browser"; "Browser"; $name | sub("^mcp__.*__"; ""))
  else line("-"; "Tool"; $name | sub("^mcp__"; "")) end;

def tool_error: if type == "array" then map(.text? // "") | join(" ") else tostring end;

def claude:
  if .type == "assistant" then
    .message.content[]?
    | if .type == "tool_use" then tool(.name; .input // {})
      elif .type == "text" and ((.text // "") | length) > 0 then line("-"; "Say"; .text)
      else empty end
  elif .type == "user" then .message.content[]? | select(.type == "tool_result" and .is_error == true) | line("-"; "Error"; .content | tool_error)
  elif .type == "result" then line("-"; "Done"; "\(.subtype // "end") after \(.num_turns // 0) turns")
  else empty end;

def codex:
  if .type == "item.completed" then
    .item
    | if .type == "command_execution" then
        (.command // "" | tostring | sub("^/bin/(ba|z)sh -lc '"; "") | sub("'$"; "")) as $c
        | if (.exit_code // 0) == 0 then line($c | bash_step; "Bash"; $c) else line("-"; "Error"; "exit \(.exit_code): \($c)") end
      elif .type == "file_change" then line("implement"; "Edit"; [.changes[]?.path] | join(", "))
      elif .type == "agent_message" then line("-"; "Say"; .text // "")
      else empty end
  elif .type == "turn.failed" then line("-"; "Error"; .error.message // "turn failed")
  elif .type == "turn.completed" then line("-"; "Done"; "turn complete")
  else empty end;

def copilot:
  if .type == "tool.execution_start" then tool(.data.toolName // ""; .data.arguments | args)
  elif .type == "tool.execution_complete" and .data.success == false then line("-"; "Error"; .data.error.message // "tool failed")
  elif .type == "assistant.message" and ((.data.content // "") | length) > 0 then line("-"; "Say"; .data.content)
  elif .type == "result" then line("-"; "Done"; "exit \(.exitCode // 0)")
  else empty end;

fromjson? | objects | try (if $agent == "codex" then codex elif $agent == "copilot" then copilot else claude end) catch empty
