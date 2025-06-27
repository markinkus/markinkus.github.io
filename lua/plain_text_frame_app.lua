-- lua/plain_text_scrollable_frame_app.lua

local data       = require('data.min')
local plain_text = require('plain_text.min')

-- Phone to Frame msg code
TEXT_MSG = 0x0a
data.parsers[TEXT_MSG] = plain_text.parse_plain_text

-- Layout constants
local CHAR_PER_LINE  = 25   -- quanti caratteri massimi per riga
local LINES_PER_PAGE = 5    -- quante righe mostro per “pagina”
local LINE_HEIGHT    = 60   -- pixel di spaziatura verticale

-- Stato
local wrapped_lines = {}  -- array di righe wrappate
local page_index    = 1   -- indice della riga di partenza

-- Wrapping semplice: spezza la stringa in blocchi di CHAR_PER_LINE
local function wrap_text(str)
    local result = {}
    local len = #str
    local i = 1
    while i <= len do
        table.insert(result,
            str:sub(i, math.min(i + CHAR_PER_LINE - 1, len))
        )
        i = i + CHAR_PER_LINE
    end
    return result
end

-- Pulisce il display
local function clear_display()
    frame.display.text(" ", 1, 1)
    frame.display.show()
    frame.sleep(0.04)
end

-- Mostra la “pagina” corrente di righe
local function render_page()
    clear_display()
    for offset = 0, LINES_PER_PAGE - 1 do
        local idx = page_index + offset
        local line = wrapped_lines[idx]
        if not line then break end
        frame.display.text(line, 1, offset * LINE_HEIGHT + 1)
    end
    frame.display.show()
end

-- Callback al “tap”: avanza di una pagina, o torna all’inizio
local function on_tap()
    page_index = page_index + LINES_PER_PAGE
    if page_index > #wrapped_lines then
        page_index = 1
    end
    render_page()
end

-- Attiva subito il tap callback
frame.imu.tap_callback(on_tap)

-- Main loop, con pcall per non far crashare l’app
function app_loop()
    clear_display()
    print('Frame scroll app in esecuzione')
    while true do
        local ok, err = pcall(function()
            local ready = data.process_raw_items()
            if ready > 0 and data.app_data[TEXT_MSG] then
                local txt = data.app_data[TEXT_MSG].string or ""
                wrapped_lines = wrap_text(txt)
                page_index = 1
                render_page()
                data.app_data[TEXT_MSG] = nil
            end
        end)
        if not ok then
            -- stampa l’errore sullo stdout (vedi console host)
            print('Errore in app_loop:', err)
            clear_display()
        end
        frame.sleep(0.1)
    end
end

app_loop()
