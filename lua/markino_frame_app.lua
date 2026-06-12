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
local LUA_ANIMATION_MSG = 0x30
data.parsers[PLAIN_TEXT_MSG]     = plain_txt.parse_plain_text
data.parsers[CAPTURE_SETTINGS_MSG] = camera.parse_capture_settings
data.parsers[IMAGE_SPRITE_MSG]   = sprite.parse_sprite
data.parsers[IMAGE_SPRITE_BLOCK] = img_block.parse_image_sprite_block
data.parsers[TEXT_SPRITE_BLOCK]  = txt_block.parse_text_sprite_block
local function parse_lua_animation(raw)
  local parts = {}
  for part in string.gmatch(raw .. "|", "(.-)|") do
    parts[#parts + 1] = part
  end
  return {
    mode = parts[1] or "stop",
    title = parts[2] or "",
    body = parts[3] or "",
    color = parts[4] or "WHITE",
    speed = tonumber(parts[5]) or 2,
  }
end
data.parsers[LUA_ANIMATION_MSG] = parse_lua_animation
local CHAR_PER_LINE, LINES_PER_PAGE, LINE_HEIGHT = 25, 5, 60
local wrapped, page = {}, 1
local plain = { x = 1, y = 1, color = 'WHITE', spacing = 4, string = '' }
local animation = { mode = "off", title = "", body = "", color = "WHITE", speed = 2, tick = 0, wait = 0 }
local function force_gc()
  collectgarbage("collect")
  collectgarbage("collect")
end
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
local function stop_animation()
  animation.mode = "off"
  animation.tick = 0
  animation.wait = 0
end
local function clipped(s, max_len)
  s = tostring(s or "")
  if #s <= max_len then return s end
  return s:sub(1, max_len)
end
local function draw_text(s, x, y, color, spacing)
  frame.display.text(
    clipped(s, 36),
    x,
    y,
    { color = color or animation.color or "WHITE", spacing = spacing or 4 }
  )
end
local function padded_bar(progress, width)
  local filled = math.floor(progress * width)
  if filled < 0 then filled = 0 end
  if filled > width then filled = width end
  return "[" .. string.rep("=", filled) .. string.rep("-", width - filled) .. "]"
end
local function render_lua_animation()
  if animation.mode == "off" then return end

  animation.wait = animation.wait + 1
  local delay = 8 - (animation.speed or 2)
  if delay < 2 then delay = 2 end
  if animation.wait < delay then return end
  animation.wait = 0
  animation.tick = animation.tick + 1

  local mode = animation.mode
  local title = clipped(animation.title, 24)
  local body = clipped(animation.body, 48)
  local color = animation.color or "WHITE"
  local phase = animation.tick % 12

  clear_display()

  if mode == "blink" then
    if animation.tick % 2 == 0 then
      draw_text(title, 24, 54, color, 4)
      draw_text(body, 24, 132, "WHITE", 3)
    else
      draw_text(" ", 24, 54, color, 4)
      draw_text(body, 24, 132, "GREY", 3)
    end
  elseif mode == "ticker" then
    local msg = body
    if #msg < 28 then msg = msg .. "   " .. title end
    msg = msg .. "     " .. msg
    local start = (animation.tick % math.max(#msg - 24, 1)) + 1
    draw_text(title, 24, 54, color, 4)
    draw_text(msg:sub(start, start + 24), 24, 166, "WHITE", 2)
  elseif mode == "progress" then
    local progress = phase / 11
    draw_text(title, 24, 48, color, 4)
    draw_text(padded_bar(progress, 18), 24, 146, "GREEN", 2)
    draw_text(body, 24, 218, "WHITE", 3)
  elseif mode == "turn" then
    local arrows = { ">>>", " >>>", "  >>>", " >>>" }
    local arrow = arrows[(animation.tick % #arrows) + 1]
    draw_text(arrow, 34, 48, "YELLOW", 8)
    draw_text(title, 24, 160, color, 4)
    draw_text(body, 24, 232, "WHITE", 3)
  else
    local pulse_color = color
    if mode == "pulse" and animation.tick % 2 == 1 then pulse_color = "SKYBLUE" end
    local dots = string.rep(".", animation.tick % 4)
    draw_text(title .. dots, 24, 64, pulse_color, 4)
    draw_text(body, 24, 150, "WHITE", 3)
  end

  frame.display.show()
end
local function start_lua_animation(cmd)
  local mode = cmd.mode or "stop"
  if mode == "stop" or mode == "off" or mode == "none" then
    stop_animation()
    clear_display()
    return
  end
  animation.mode = mode
  animation.title = cmd.title or ""
  animation.body = cmd.body or ""
  animation.color = cmd.color or "WHITE"
  animation.speed = cmd.speed or 2
  if animation.speed < 1 then animation.speed = 1 end
  if animation.speed > 5 then animation.speed = 5 end
  animation.tick = 0
  animation.wait = 0
  render_lua_animation()
end
local function render_plain_paged()
  clear_display()
  for i = 0, LINES_PER_PAGE - 1 do
    local line = wrapped[page + i]
    if not line then break end
    frame.display.text(
      line,
      plain.x or 1,
      (plain.y or 1) + i * LINE_HEIGHT,
      { color = plain.color or 'WHITE', spacing = plain.spacing or 4 }
    )
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
  force_gc()
  sprite.set_palette(spr.num_colors, spr.palette_data)
  frame.display.bitmap(1, 1, spr.width, 2 ^ spr.bpp, 0, spr.pixel_data)
  frame.display.show()
  force_gc()
end
local function render_image_block(isb)
  if isb.current_sprite_index == 0 then return end
  force_gc()
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
  force_gc()
end
local function render_text_block(tsb)
  if tsb.first_sprite_index == 0 then return end
  local spr0 = tsb.sprites[tsb.first_sprite_index]
  sprite.set_palette(spr0.num_colors, spr0.palette_data)
  local active = tsb.active_sprites or #tsb.sprites
  for idx = 1, active do
    local spr = tsb.sprites[idx]
    local y
    if tsb.offsets and tsb.offsets[idx] then
      y = tsb.offsets[idx].y
    elseif tsb.sprite_line_height then
      y = tsb.sprite_line_height * (idx - 1)
    else
      y = (idx - 1) * spr.height
    end
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
        stop_animation()
        plain = data.app_data[PLAIN_TEXT_MSG]
        wrapped = wrap_text(plain.string or "")
        page    = 1
        render_plain_paged()
        data.app_data[PLAIN_TEXT_MSG] = nil
      end
      if data.app_data[CAPTURE_SETTINGS_MSG] then
        for _ = 1, 12 do
          camera.run_auto_exposure()
          frame.sleep(0.1)
        end
        camera.capture_and_send(data.app_data[CAPTURE_SETTINGS_MSG])
        data.app_data[CAPTURE_SETTINGS_MSG] = nil
      end
      if data.app_data[IMAGE_SPRITE_MSG] then
        stop_animation()
        render_sprite(data.app_data[IMAGE_SPRITE_MSG])
        data.app_data[IMAGE_SPRITE_MSG] = nil
        force_gc()
      end
      if data.app_data[IMAGE_SPRITE_BLOCK] then
        stop_animation()
        render_image_block(data.app_data[IMAGE_SPRITE_BLOCK])
        data.app_data[IMAGE_SPRITE_BLOCK] = nil
        force_gc()
      end
      if data.app_data[TEXT_SPRITE_BLOCK] then
        stop_animation()
        local tsb = data.app_data[TEXT_SPRITE_BLOCK]
        local active = tsb.active_sprites or #tsb.sprites
        local total  = tsb.total_sprites  or (tsb.offsets and #tsb.offsets) or 0
        if tsb.first_sprite_index > 0 and active == total then
          clear_display()
          render_text_block(tsb)
          data.app_data[TEXT_SPRITE_BLOCK] = nil
          force_gc()
        end
      end
      if data.app_data[LUA_ANIMATION_MSG] then
        start_lua_animation(data.app_data[LUA_ANIMATION_MSG])
        data.app_data[LUA_ANIMATION_MSG] = nil
      end
    end
    render_lua_animation()
  end)
  if not ok then
    print("Error:", err)
    clear_display()
  end
  frame.sleep(0.05)
end
