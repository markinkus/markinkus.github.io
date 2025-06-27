local data = require('data.min')
local plain_text = require('plain_text.min')

TEXT_FLAG = 0x0a

data.parsers[TEXT_FLAG] = plain_text.parse_plain_text

function print_text(text)
    local i = 0
    for line in text:gmatch('([^\n]*)\n?') do
        if line ~= "" then
            frame.display.text(line, 1, i * 60 + 1)
            i = i + 1
        end
    end
end

function app_loop()
    frame.display.text('Frame App Started', 1, 1)
    frame.display.show()
    print('Frame app is running')
    while true do
        rc, err = pcall(
            function()
                local items_ready = data.process_raw_items()
                if items_ready > 0 then
                    if data.app_data[TEXT_FLAG] ~= nil and data.app_data[TEXT_FLAG].string ~= nil then
                        local text = data.app_data[TEXT_FLAG]
                        print_text(text.string)
                        frame.display.show()
                        data.app_data[TEXT_FLAG] = nil
                        collectgarbage('collect')
                    end
                end
                frame.sleep(0.001)
            end
        )
        if rc == false then
            print(err)
            frame.display.text(' ', 1, 1)
            frame.display.show()
            break
        end
    end
end

app_loop()
