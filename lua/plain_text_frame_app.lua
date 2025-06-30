local d=require('data.min')local p=require('plain_text.min')local c=require('camera.min')local i=require('image_sprite_block.min')
TEXT=0x0A CAP=0x0D IMG=0x20
d.parsers[TEXT]=p.parse_plain_text d.parsers[CAP]=c.parse_capture_settings d.parsers[IMG]=i.parse_image_sprite_block
local C,L,H=25,5,60
local W,pi,= {},1
local function w(s)local o={}for n=1,#s,C do o[#o+1]=s:sub(n,n+C-1)end return o end
local function e()frame.display.text(" ",1,1)frame.display.show()frame.sleep(.04)end
local function r()e()for o=0,L-1 do local l=W[pi+o]if not l then break end frame.display.text(l,1,o*H+1)end frame.display.show()end
local function t()pi=pi+L if pi>#W then pi=1 end r()end frame.imu.tap_callback(t)
local function a()e()print'App in esecuzione'while true do local ok,err=pcall(function()local n=d.process_raw_items()if n>0 then
 if d.app_data[TEXT]then W=w(d.app_data[TEXT].string or"")pi=1 r() d.app_data[TEXT]=nil end
 if d.app_data[CAP]then c.capture_and_send(d.app_data[CAP]) d.app_data[CAP]=nil end
 if d.app_data[IMG]then local B=d.app_data[IMG]if B.current_sprite_index>0 and(B.progressive_render or B.active_sprites==B.total_sprites)then
  for j=1,B.active_sprites do local s=B.sprites[j]if j==1 then i.set_palette(s.num_colors,s.palette_data)end
   frame.display.bitmap(1,(j-1)*B.sprite_line_height+1,s.width,2^s.bpp,0,s.pixel_data)end frame.display.show()end d.app_data[IMG]=nil end
end end)if not ok then print(err)e()end frame.sleep(.1)end end a()
