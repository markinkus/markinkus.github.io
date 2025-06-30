local data = require('data.min')
local plain_text = require('plain_text.min')
local camera = require('camera.min')
TEXT_MSG = 0x0A
CAPTURE_SETTINGS_MSG = 0x0D
data.parsers[TEXT_MSG] = plain_text.parse_plain_text
data.parsers[CAPTURE_SETTINGS_MSG] = camera.parse_capture_settings
local CHAR_PER_LINE  = 25
local LINES_PER_PAGE = 5
local LINE_HEIGHT    = 60
local wrapped_lines = {}
local page_index    = 1
local function wrap_text(str)
  local out = {}
  local len = #str
  local i = 1
  while i <= len do
    table.insert(out, str:sub(i, math.min(i + CHAR_PER_LINE - 1, len)))
    i = i + CHAR_PER_LINE
  end
  return out
end
local function clear_display()
  frame.display.text(" ", 1, 1)
  frame.display.show()
  frame.sleep(0.04)
end
local function render_page()
  clear_display()
  for off = 0, LINES_PER_PAGE - 1 do
    local idx = page_index + off
    if not wrapped_lines[idx] then break end
    frame.display.text(wrapped_lines[idx], 1, off * LINE_HEIGHT + 1)
  end
  frame.display.show()
end
local function on_tap()
  page_index = page_index + LINES_PER_PAGE
  if page_index > #wrapped_lines then
    page_index = 1
  end
  render_page()
end
frame.imu.tap_callback(on_tap)
local function app_loop()
  clear_display()
  print('App attiva')
  while true do
    local ok, err = pcall(function()
      local ready = data.process_raw_items()
      if ready > 0 then
        if data.app_data[TEXT_MSG] then
          local txt = data.app_data[TEXT_MSG].string or ""
          wrapped_lines = wrap_text(txt)
          page_index    = 1
          render_page()
          data.app_data[TEXT_MSG] = nil
        end
        if data.app_data[CAPTURE_SETTINGS_MSG] then
          camera.capture_and_send(data.app_data[CAPTURE_SETTINGS_MSG])
          data.app_data[CAPTURE_SETTINGS_MSG] = nil
        end
      end
    end)
    if not ok then
      print('Errore:', err)
      clear_display()
    end
    frame.sleep(0.1)
  end
end
app_loop()
