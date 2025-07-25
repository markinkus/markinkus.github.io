local data = require('data.min')
local plain_txt = require('plain_text.min')
local img_block = require('image_sprite_block.min')
local txt_block = require('text_sprite_block.min')
local IMAGE_SPRITE_BLOCK = 0x20
local TEXT_SPRITE_BLOCK = 0x21
local PLAIN_TEXT_MSG = 0x0A
data.parsers[IMAGE_SPRITE_BLOCK] = img_block.parse_image_sprite_block
data.parsers[TEXT_SPRITE_BLOCK] = txt_block.parse_text_sprite_block
data.parsers[PLAIN_TEXT_MSG] = plain_txt.parse_plain_text
local function clear_display()
  frame.display.text(" ", 1, 1)
  frame.display.show()
  frame.sleep(0.04)
end
local function render_image_block(isb)
  if isb.current_sprite_index==0 then return end
  for i=1, isb.active_sprites do
    local spr = isb.sprites[i]
    local y   = isb.sprite_line_height*(i-1)
    if spr.compressed then
      frame.compression.process_function(function(decmp)
        frame.display.bitmap(1, y+1, spr.width, 2^spr.bpp, 0, decmp)
      end)
      local full_bytes = (spr.width*spr.height + ((8/spr.bpp)-1))//(8/spr.bpp)
      frame.compression.decompress(spr.pixel_data, full_bytes)
    else
      frame.display.bitmap(1, y+1, spr.width, 2^spr.bpp, 0, spr.pixel_data)
    end
  end
  frame.display.show()
end
local function render_text_block(tsb)
  if tsb.first_sprite_index==0 then return end
  for i=1, tsb.active_sprites do
    local spr = tsb.sprites[i]
    local y   = tsb.offsets[i].y or ((i-1)*spr.height)
    frame.display.bitmap(1, y+1, spr.width, 2^spr.bpp, 0, spr.pixel_data)
  end
  frame.display.show()
end
local function render_plain_text(pt)
  clear_display()
  local row=0
  for line in pt.string:gmatch("([^\n]*)\n?") do
    if line~="" then
      frame.display.text(line, 1, row*60 + 1)
      row = row + 1
    end
  end
  frame.display.show()
end
clear_display()
print("Combined app running")
while true do
  local ok, err = pcall(function()
    if data.process_raw_items()>0 then
      if data.app_data[IMAGE_SPRITE_BLOCK] then
        render_image_block(data.app_data[IMAGE_SPRITE_BLOCK])
        data.app_data[IMAGE_SPRITE_BLOCK] = nil
        collectgarbage()
      end
      if data.app_data[TEXT_SPRITE_BLOCK] then
        clear_display()
        render_text_block(data.app_data[TEXT_SPRITE_BLOCK])
        data.app_data[TEXT_SPRITE_BLOCK] = nil
        collectgarbage()
      end
      if data.app_data[PLAIN_TEXT_MSG] then
        render_plain_text(data.app_data[PLAIN_TEXT_MSG])
        data.app_data[PLAIN_TEXT_MSG] = nil
      end
    end
  end)
  if not ok then
    print("Error:", err)
    clear_display()
  end
  frame.sleep(0.05)
end