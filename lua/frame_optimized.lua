-- Frame BLE Web App - Script Lua Ottimizzato
-- Versione: 1.0
-- Autore: Manus AI
-- Data: 22 Luglio 2025

-- Importa le librerie necessarie
local data = require('data.min')
local plain_txt = require('plain_text.min')
local camera = require('camera.min')
local sprite = require('sprite.min')

-- Definizione dei tipi di messaggio
local TEXT_MSG = 0x0A
local CAPTURE_SETTINGS_MSG = 0x0D
local IMAGE_SPRITE_MSG = 0x20
local AR_MAP_MSG = 0x21  -- Nuovo tipo per mappe AR

-- Registra i parser per i diversi tipi di messaggio
data.parsers[TEXT_MSG] = plain_txt.parse_plain_text
data.parsers[CAPTURE_SETTINGS_MSG] = camera.parse_capture_settings
data.parsers[IMAGE_SPRITE_MSG] = sprite.parse_sprite
data.parsers[AR_MAP_MSG] = sprite.parse_sprite

-- Configurazione display
local CHAR_PER_LINE = 25
local LINES_PER_PAGE = 5
local LINE_HEIGHT = 60
local MAX_DISPLAY_WIDTH = 640
local MAX_DISPLAY_HEIGHT = 400

-- Variabili globali
local wrapped = {}
local page = 1
local current_mode = "text"  -- "text", "image", "ar_map"

-- Funzione per wrapping del testo
local function wrap(s)
  local out = {}
  for i = 1, #s, CHAR_PER_LINE do
    out[#out + 1] = s:sub(i, i + CHAR_PER_LINE - 1)
  end
  return out
end

-- Funzione per pulire il display
local function clear()
  frame.display.text(' ', 1, 1)
  frame.display.show()
  frame.sleep(0.04)
end

-- Funzione per renderizzare il testo
local function render_text()
  clear()
  for o = 0, LINES_PER_PAGE - 1 do
    local L = wrapped[page + o]
    if not L then break end
    frame.display.text(L, 1, o * LINE_HEIGHT + 1)
  end
  frame.display.show()
end

-- Funzione per ridimensionare automaticamente le immagini grandi
local function scale_image_data(sprite_data, max_width, max_height)
  if sprite_data.width <= max_width and sprite_data.height <= max_height then
    return sprite_data
  end
  
  local scale_factor_w = max_width / sprite_data.width
  local scale_factor_h = max_height / sprite_data.height
  local scale_factor = math.min(scale_factor_w, scale_factor_h)
  
  local new_width = math.floor(sprite_data.width * scale_factor)
  local new_height = math.floor(sprite_data.height * scale_factor)
  
  print("Ridimensionamento: " .. sprite_data.width .. "x" .. sprite_data.height .. 
        " -> " .. new_width .. "x" .. new_height)
  
  return {
    width = new_width,
    height = new_height,
    bpp = sprite_data.bpp,
    num_colors = sprite_data.num_colors,
    palette_data = sprite_data.palette_data,
    pixel_data = sprite_data.pixel_data
  }
end

-- Funzione per visualizzare sprite con ottimizzazioni
local function display_sprite(spr, is_ar_map)
  if not spr then
    print("Errore: sprite nullo")
    return false
  end
  
  print("Sprite ricevuto: " .. spr.width .. "x" .. spr.height .. " bpp:" .. spr.bpp)
  
  -- Ridimensiona se necessario
  if spr.width > MAX_DISPLAY_WIDTH or spr.height > MAX_DISPLAY_HEIGHT then
    print("Sprite troppo grande, ridimensionamento...")
    spr = scale_image_data(spr, MAX_DISPLAY_WIDTH, MAX_DISPLAY_HEIGHT)
  end
  
  -- Imposta la palette se presente
  if spr.num_colors and spr.num_colors > 0 and spr.palette_data then
    sprite.set_palette(spr.num_colors, spr.palette_data)
  end
  
  -- Calcola posizione centrata
  local x_offset = math.max(1, (MAX_DISPLAY_WIDTH - spr.width) / 2)
  local y_offset = math.max(1, (MAX_DISPLAY_HEIGHT - spr.height) / 2)
  
  -- Pulisce il display prima di mostrare l'immagine
  clear()
  
  -- Visualizza lo sprite
  local success, err = pcall(function()
    frame.display.bitmap(x_offset, y_offset, spr.width, spr.height, 0, spr.pixel_data)
    frame.display.show()
  end)
  
  if success then
    current_mode = is_ar_map and "ar_map" or "image"
    print("Sprite visualizzato con successo")
    return true
  else
    print("Errore visualizzazione sprite: " .. tostring(err))
    return false
  end
end

-- Funzione per gestire il tap (tocco)
local function on_tap()
  if current_mode == "text" then
    -- Navigazione pagine per il testo
    page = page + LINES_PER_PAGE
    if page > #wrapped then 
      page = 1 
    end
    render_text()
  elseif current_mode == "image" or current_mode == "ar_map" then
    -- Per immagini e mappe AR, torna alla modalità testo
    current_mode = "text"
    if #wrapped > 0 then
      render_text()
    else
      clear()
      frame.display.text("Nessun testo disponibile", 1, 1)
      frame.display.show()
    end
  end
end

-- Registra il callback per il tap
frame.imu.tap_callback(on_tap)

-- Inizializzazione
clear()
print('Frame BLE Web App - Script Lua Ottimizzato v1.0')
print('Supporto per:')
print('- Testo con paginazione')
print('- Immagini Pollination ottimizzate')
print('- Mappe AR con navigazione')
print('- Ridimensionamento automatico')
print('In esecuzione...')

-- Loop principale ottimizzato
while true do
  local ok, err = pcall(function()
    local n = data.process_raw_items()
    if n > 0 then
      
      -- Gestione messaggi di testo
      if data.app_data[TEXT_MSG] then
        local text_data = data.app_data[TEXT_MSG]
        if text_data and text_data.string then
          wrapped = wrap(text_data.string)
          page = 1
          current_mode = "text"
          render_text()
          print("Testo ricevuto: " .. #wrapped .. " righe")
        end
        data.app_data[TEXT_MSG] = nil
      end
      
      -- Gestione impostazioni fotocamera
      if data.app_data[CAPTURE_SETTINGS_MSG] then
        camera.capture_and_send(data.app_data[CAPTURE_SETTINGS_MSG])
        data.app_data[CAPTURE_SETTINGS_MSG] = nil
        print("Foto catturata")
      end
      
      -- Gestione sprite immagini (Pollination)
      if data.app_data[IMAGE_SPRITE_MSG] then
        local spr = data.app_data[IMAGE_SPRITE_MSG]
        print("Processando sprite immagine...")
        
        local success = display_sprite(spr, false)
        if not success then
          -- Fallback: mostra messaggio di errore
          clear()
          frame.display.text("Errore caricamento", 1, 1)
          frame.display.text("immagine", 1, LINE_HEIGHT + 1)
          frame.display.show()
        end
        
        data.app_data[IMAGE_SPRITE_MSG] = nil
        collectgarbage('collect')  -- Libera memoria
      end
      
      -- Gestione mappe AR
      if data.app_data[AR_MAP_MSG] then
        local spr = data.app_data[AR_MAP_MSG]
        print("Processando mappa AR...")
        
        local success = display_sprite(spr, true)
        if not success then
          -- Fallback: mostra messaggio di errore
          clear()
          frame.display.text("Errore caricamento", 1, 1)
          frame.display.text("mappa AR", 1, LINE_HEIGHT + 1)
          frame.display.show()
        end
        
        data.app_data[AR_MAP_MSG] = nil
        collectgarbage('collect')  -- Libera memoria
      end
    end
  end)
  
  -- Gestione errori robusta
  if not ok then
    print('Errore nel loop principale:', err)
    clear()
    frame.display.text("Errore sistema", 1, 1)
    frame.display.text("Riavvio...", 1, LINE_HEIGHT + 1)
    frame.display.show()
    frame.sleep(2)
    clear()
  end
  
  -- Pausa per evitare sovraccarico CPU
  frame.sleep(0.1)
end

