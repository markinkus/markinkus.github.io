-- lua/plain_text_scrollable_frame_app.lua

local data       = require('data.min')
local plain_text = require('plain_text.min')

-- msgCode per plain text
TEXT_FLAG = 0x0a
data.parsers[TEXT_FLAG] = plain_text.parse_plain_text

-- Parametri di layout
local char_per_line   = 25      -- max caratteri per riga
local lines_per_page  = 5       -- quante righe per “pagina”
local line_height     = 60      -- pixel tra le righe

-- Stato
local lines  = {}   -- righe di testo “wrappate”
local scroll = 0    -- indice di riga da cui cominciare

-- Funzione di “wrapping” del testo
local function wrap_text(text)
  local t = {}
  for i = 1, #text, char_per_line do
    table.insert(t, text:sub(i, i + char_per_line - 1))
  end
  return t
end

-- Pulisce lo schermo
local function clear_display()
  frame.display.text(" ", 1, 1)
  frame.display.show()
  frame.sleep(0.04)
end

-- Mostra la pagina corrente di righe
local function render()
  clear_display()
  for i = 1, lines_per_page do
    local idx = scroll + i
    if not lines[idx] then break end
    frame.display.text(lines[idx], 1, (i - 1) * line_height + 1)
  end
  frame.display.show()
end

-- Tap callback: avanza di una “pagina”, o torna a zero
local function on_tap()
  scroll = scroll + lines_per_page
  if scroll >= #lines then scroll = 0 end
  render()
end

-- Attiva subito il callback sui tap
frame.imu.tap_callback(on_tap)

-- Main loop
function app_loop()
  frame.display.text('Frame App Started', 1, 1)
  frame.display.show()
  print('Frame app is running')

  while true do
    local items_ready = data.process_raw_items()
    if items_ready > 0 and data.app_data[TEXT_FLAG] then
      -- arrivo nuovo testo: wrappalo e mostra la prima pagina
      lines  = wrap_text(data.app_data[TEXT_FLAG].string)
      scroll = 0
      render()
      data.app_data[TEXT_FLAG] = nil
    end
    frame.sleep(0.1)
  end
end

app_loop()
