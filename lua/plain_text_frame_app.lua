local data      = require('data.min')
local plain_txt = require('plain_text.min')
local camera    = require('camera.min')
local img_blk   = require('image_sprite_block.min')
TEXT_MSG             = 0x0A
CAPTURE_SETTINGS_MSG = 0x0D
IMAGE_SPRITE_BLOCK   = 0x20
data.parsers[TEXT_MSG]             = plain_txt.parse_plain_text
data.parsers[CAPTURE_SETTINGS_MSG] = camera.parse_capture_settings
data.parsers[IMAGE_SPRITE_BLOCK]   = img_blk.parse_image_sprite_block
local CHAR_PER_LINE  = 25
local LINES_PER_PAGE = 5
local LINE_HEIGHT    = 60
local wrapped = {}
local page    = 1
local function wrap(s)
    local out = {}
    for i=1,#s,CHAR_PER_LINE do
        out[#out+1] = s:sub(i, i+CHAR_PER_LINE-1)
    end
    return out
end
local function clear()
    frame.display.text(" ",1,1)
    frame.display.show()
    frame.sleep(0.04)
end
local function render()
    clear()
    for o=0,LINES_PER_PAGE-1 do
        local L = wrapped[page+o]
        if not L then break end
        frame.display.text(L,1,o*LINE_HEIGHT+1)
    end
    frame.display.show()
end
local function on_tap()
    page = page + LINES_PER_PAGE
    if page > #wrapped then page = 1 end
    render()
end
frame.imu.tap_callback(on_tap)
local function loop()
    clear()
    print("In esecuzione")
    while true do
        local ok,err = pcall(function()
            local n = data.process_raw_items()
            if n>0 then
                if data.app_data[TEXT_MSG] then
                    wrapped = wrap(data.app_data[TEXT_MSG].string or "")
                    page    = 1
                    render()
                    data.app_data[TEXT_MSG] = nil
                end
                if data.app_data[CAPTURE_SETTINGS_MSG] then
                    camera.capture_and_send(data.app_data[CAPTURE_SETTINGS_MSG])
                    data.app_data[CAPTURE_SETTINGS_MSG] = nil
                end
                if data.app_data[IMAGE_SPRITE_BLOCK] then
                    local isb = data.app_data[IMAGE_SPRITE_BLOCK]
                    if isb.current_sprite_index>0 and
                       (isb.progressive_render or isb.active_sprites==isb.total_sprites)
                    then
                        for i=1,isb.active_sprites do
                            local spr = isb.sprites[i]
                            if i==1 then
                                img_blk.set_palette(spr.num_colors, spr.palette_data)
                            end
                            frame.display.bitmap(
                                1,
                                (i-1)*isb.sprite_line_height+1,
                                spr.width,
                                2^spr.bpp,
                                0,
                                spr.pixel_data
                            )
                        end
                        frame.display.show()
                    end
                    data.app_data[IMAGE_SPRITE_BLOCK] = nil
                end
            end
        end)
        if not ok then
            print("Errore:", err)
            clear()
        end
        frame.sleep(0.1)
    end
end
loop()
