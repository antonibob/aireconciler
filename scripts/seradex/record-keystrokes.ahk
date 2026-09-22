#Requires AutoHotkey v2.0
#SingleInstance Force
Persistent

/*
    Record your own keystrokes while entering an invoice, so the workflow can
    be replayed as a macro.

    F9   start recording
    F10  stop recording
    F12  quit

    Writes to keystroke-log.txt next to this script.

    SCOPED ON PURPOSE: it only records while a window matching WINDOW_FILTER is
    active. Anything you type in another app — passwords, email, chat — is
    ignored. Set WINDOW_FILTER to "" to record everything, but don't leave it
    that way.

    It also logs every change of active window, which captures the title of the
    Save prompt and any other dialog — those titles are what a macro waits on.
*/

WINDOW_FILTER := "Vendor Invoicing"
LogFile       := A_ScriptDir "\keystroke-log.txt"

Recording := false
ih        := ""
LastTitle := ""

F9::StartRecording()
F10::StopRecording()
F12::ExitApp()

StartRecording() {
    global Recording, ih, LogFile, LastTitle
    if Recording
        return
    Recording := true
    LastTitle := ""

    Write("")
    Write("=== recording started " FormatTime(, "yyyy-MM-dd HH:mm:ss") " ===")
    Write("=== window filter: '" WINDOW_FILTER "' ===")

    ih := InputHook("V")           ; V: keys still reach the application
    ih.KeyOpt("{All}", "N")        ; notify on every key
    ih.OnKeyDown := LogKey
    ih.Start()

    SetTimer(WatchWindow, 250)
    Notify("RECORDING - F10 to stop")
}

StopRecording() {
    global Recording, ih
    if !Recording
        return
    Recording := false
    try ih.Stop()
    SetTimer(WatchWindow, 0)
    Write("=== recording stopped " FormatTime(, "yyyy-MM-dd HH:mm:ss") " ===")
    Notify("Stopped - saved to keystroke-log.txt")
}

; Log a change of active window: this is how dialog titles get captured.
WatchWindow() {
    global LastTitle
    try title := WinGetTitle("A")
    catch
        return
    if (title != LastTitle) {
        LastTitle := title
        Write("[window] " title)
    }
}

LogKey(hook, vk, sc) {
    global WINDOW_FILTER
    try title := WinGetTitle("A")
    catch
        return
    if (WINDOW_FILTER != "" && !InStr(title, WINDOW_FILTER))
        return

    key := GetKeyName(Format("vk{:x}sc{:x}", vk, sc))
    if (key = "")
        return

    mods := ""
    if GetKeyState("Ctrl",  "P")
        mods .= "Ctrl+"
    if GetKeyState("Alt",   "P")
        mods .= "Alt+"
    if GetKeyState("Shift", "P") && StrLen(key) > 1
        mods .= "Shift+"      ; shifted letters already read correctly

    Write(FormatTime(, "HH:mm:ss") "  " mods key)
}

Write(text) {
    global LogFile
    try FileAppend(text "`n", LogFile, "UTF-8")
}

Notify(text) {
    ToolTip(text)
    SetTimer(() => ToolTip(), -2500)
}
