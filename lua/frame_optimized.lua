local data = require('data.min')
local plain_txt = require('plain_text.min')
local txt_block = require('text_sprite_block.min')
local img_block = require('image_sprite_block.min')
local camera = require('camera.min')
local sprite = require('sprite.min')
local PLAIN_TEXT_MSG = 0x0A
local CAPTURE_SETTINGS_MSG = 0x0D
local IMAGE_SPRITE_MSG = 0x20
local IMAGE_SPRITE_BLOCK = 0x21
local TEXT_SPRITE_BLOCK = 0x22
data.parsers[PLAIN_TEXT_MSG]     = plain_txt.parse_plain_text
data.parsers[CAPTURE_SETTINGS_MSG] = camera.parse_capture_settings
data.parsers[IMAGE_SPRITE_MSG]   = sprite.parse_sprite
data.parsers[IMAGE_SPRITE_BLOCK] = img_block.parse_image_sprite_block
data.parsers[TEXT_SPRITE_BLOCK]  = txt_block.parse_text_sprite_block
local CHAR_PER_LINE, LINES_PER_PAGE, LINE_HEIGHT = 25, 5, 60
local wrapped, page = {}, 1
local function wrap_text(s)
  local out = {}
  for i = 1, #s, CHAR_PER_LINE do
    out[#out + 1] = s:sub(i, i + CHAR_PER_LINE - 1)
  end
  return out
end
local function clear_display()
  frame.display.text(" ", 1, 1)
  frame.display.show()
  frame.sleep(0.04)
end
local function render_plain_paged()
  clear_display()
  for i = 0, LINES_PER_PAGE - 1 do
    local line = wrapped[page + i]
    if not line then break end
    frame.display.text(line, 1, i * LINE_HEIGHT + 1)
  end
  frame.display.show()
end
local function on_tap()
  page = page + LINES_PER_PAGE
  if page > #wrapped then page = 1 end
  render_plain_paged()
end
frame.imu.tap_callback(on_tap)
local function render_sprite(spr)
  sprite.set_palette(spr.num_colors, spr.palette_data)
  frame.display.bitmap(1, 1, spr.width, 2 ^ spr.bpp, 0, spr.pixel_data)
  frame.display.show()
end
local function render_image_block(isb)
  if isb.current_sprite_index == 0 then return end
  for idx = 1, isb.active_sprites do
    local spr = isb.sprites[idx]
    local y   = isb.sprite_line_height * (idx - 1)
    if spr.compressed then
      frame.compression.process_function(function(decmp)
        frame.display.bitmap(1, y + 1, spr.width, 2 ^ spr.bpp, 0, decmp)
      end)
      local full_bytes = (spr.width * spr.height + ((8 / spr.bpp) - 1)) // (8 / spr.bpp)
      frame.compression.decompress(spr.pixel_data, full_bytes)
    else
      frame.display.bitmap(1, y + 1, spr.width, 2 ^ spr.bpp, 0, spr.pixel_data)
    end
  end
  frame.display.show()
end
local function render_text_block(tsb)
  if tsb.first_sprite_index == 0 then return end
  local spr0 = tsb.sprites[tsb.first_sprite_index]
  sprite.set_palette(spr0.num_colors, spr0.palette_data)
  for idx = 1, tsb.active_sprites do
    local spr = tsb.sprites[idx]
    local y   = tsb.offsets[idx].y or ((idx - 1) * spr.height)
    frame.display.bitmap(1, y + 1, spr.width, 2 ^ spr.bpp, 0, spr.pixel_data)
  end
  frame.display.show()
end
clear_display()
print("Combined app running")
while true do
  local ok, err = pcall(function()
    if data.process_raw_items() > 0 then
      if data.app_data[PLAIN_TEXT_MSG] then
        wrapped = wrap_text(data.app_data[PLAIN_TEXT_MSG].string or "")
        page    = 1
        render_plain_paged()
        data.app_data[PLAIN_TEXT_MSG] = nil
      end
      if data.app_data[CAPTURE_SETTINGS_MSG] then
        camera.capture_and_send(data.app_data[CAPTURE_SETTINGS_MSG])
        data.app_data[CAPTURE_SETTINGS_MSG] = nil
      end
      if data.app_data[IMAGE_SPRITE_MSG] then
        render_sprite(data.app_data[IMAGE_SPRITE_MSG])
        data.app_data[IMAGE_SPRITE_MSG] = nil
        collectgarbage()
      end
      if data.app_data[IMAGE_SPRITE_BLOCK] then
        render_image_block(data.app_data[IMAGE_SPRITE_BLOCK])
        data.app_data[IMAGE_SPRITE_BLOCK] = nil
        collectgarbage()
      end
      if data.app_data[TEXT_SPRITE_BLOCK] then
        local tsb = data.app_data[TEXT_SPRITE_BLOCK]
        if tsb.first_sprite_index > 0
           and (tsb.progressive_render or tsb.active_sprites == tsb.total_sprites) then
          clear_display()
          render_text_block(tsb)
          data.app_data[TEXT_SPRITE_BLOCK] = nil
          collectgarbage()
        end
      end
    end
  end)
  if not ok then
    print("Error:", err)
    clear_display()
  end
  frame.sleep(0.05)
end
