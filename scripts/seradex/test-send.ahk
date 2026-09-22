#Requires AutoHotkey v2.0
#SingleInstance Force
Persistent

/*
    Which send method actually reaches Seradex over RemoteApp?

    Run this, then:
      1. click into a text field in Seradex (Vendor Invoice No is fine)
      2. press F9
      3. wait ~10 seconds without touching anything

    It tries four methods in turn, 2s apart:
      INPUT111  - SendInput      (fastest; often dropped by RDP)
      EVENT222  - SendEvent      (paced hardware-style events; usually works)
      PLAY333   - SendPlay       (driver-level; sometimes the only one that works)
      CLIP444   - clipboard paste (most robust over RDP, needs Clipboard
                                   redirection enabled on the connection)

    Whichever ones appear are the methods the macro can rely on.
    F12 quits. Clear the field afterwards — nothing here saves.
*/

F9::RunTests()
F12::ExitApp()

RunTests() {
    Notify("Click into a Seradex field NOW - starting in 3s")
    Sleep 3000

    Notify("1/4 SendInput")
    SendInput("INPUT111")
    Sleep 2000

    Notify("2/4 SendEvent (paced)")
    SetKeyDelay(60, 40)              ; 60ms between keys, 40ms press duration
    SendEvent("EVENT222")
    Sleep 2000

    Notify("3/4 SendPlay")
    try SendPlay("PLAY333")
    Sleep 2000

    Notify("4/4 clipboard paste")
    A_Clipboard := "CLIP444"
    if ClipWait(2) {
        Sleep 400                    ; let the clipboard cross the RDP channel
        SendEvent("^v")
    }
    Sleep 1000

    Notify("Done - which of INPUT111 / EVENT222 / PLAY333 / CLIP444 appeared?")
}

Notify(text) {
    ToolTip(text)
    SetTimer(() => ToolTip(), -2500)
}
