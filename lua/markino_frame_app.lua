local data = require('data.min')
local plain_txt = require('plain_text.min')
local camera = require('camera.min')
local sprite = require('sprite.min')
local TEXT_MSG = 0x0A
local CAPTURE_SETTINGS_MSG = 0x0D
local IMAGE_SPRITE_MSG = 0x20
data.parsers[TEXT_MSG] = plain_txt.parse_plain_text
data.parsers[CAPTURE_SETTINGS_MSG] = camera.parse_capture_settings
data.parsers[IMAGE_SPRITE_MSG] = sprite.parse_sprite
local CHAR_PER_LINE = 25
local LINES_PER_PAGE = 5
local LINE_HEIGHT = 60
local wrapped = {}
local page = 1
local function wrap(s)
  local out = {}
  for i = 1, #s, CHAR_PER_LINE do
    out[#out + 1] = s:sub(i, i + CHAR_PER_LINE - 1)
  end
  return out
end
local function clear()
  frame.display.text(' ', 1, 1)
  frame.display.show()
  frame.sleep(0.04)
end
local function render()
  clear()
  for o = 0, LINES_PER_PAGE - 1 do
    local L = wrapped[page + o]
    if not L then break end
    frame.display.text(L, 1, o * LINE_HEIGHT + 1)
  end
  frame.display.show()
end
local function on_tap()
  page = page + LINES_PER_PAGE
  if page > #wrapped then page = 1 end
  render()
end
frame.imu.tap_callback(on_tap)
clear()
print('In esecuzione')
while true do
  local ok, err = pcall(function()
    local n = data.process_raw_items()
    if n > 0 then
      -- testo
      if data.app_data[TEXT_MSG] then
        wrapped = wrap(data.app_data[TEXT_MSG].string or '')
        page    = 1
        render()
        data.app_data[TEXT_MSG] = nil
      end
      if data.app_data[CAPTURE_SETTINGS_MSG] then
        camera.capture_and_send(data.app_data[CAPTURE_SETTINGS_MSG])
        data.app_data[CAPTURE_SETTINGS_MSG] = nil
      end
      if data.app_data[IMAGE_SPRITE_MSG] then
        local spr = data.app_data[IMAGE_SPRITE_MSG]
        print("Sprite ricevuto", spr.width, spr.height)
        if spr.width > 640 then
          print("Sprite largo: "..spr.width)
        else
          sprite.set_palette(spr.num_colors, spr.palette_data)
          frame.display.bitmap(1, 1, spr.width, 2 ^ spr.bpp, 0, spr.pixel_data)
          frame.display.show()
        end
        data.app_data[IMAGE_SPRITE_MSG] = nil
        collectgarbage('collect')
      end
    end
  end)
  if not ok then
    print('Errore:', err)
    clear()
  end
  frame.sleep(0.1)
end
